<#
.SYNOPSIS
  boopis installer for Windows.

.DESCRIPTION
  Downloads the latest release (or the one you name, or a local file), checks its sha256 and runs its installer
  silently, for the current user: no administrator rights. -Uninstall runs the uninstaller that installer registered.

  .\install.ps1 [-Version v0.1.0] [-File <path>] [-Sha256 <hash>] [-Yes] [-Quiet] [-NoColor] [-Uninstall]

  From a pipe (`irm <where this file is served> | iex`) the switches are not available; set BOOPIS_VERSION instead.
  BOOPIS_NO_ANIMATION=1 turns the animation off; it also stops on a redirected output, a classic console and CI.
  The art at the bottom is generated: edit packaging/brand and run scripts/embed-brand.sh, not this file.
#>
[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$File = '',
    [string]$Sha256 = '',
    [switch]$Yes,
    [switch]$Quiet,
    [switch]$NoColor,
    [switch]$Uninstall
)

# Run from a pipe (irm ... | iex), this script runs inside the caller's own PowerShell session: it must never `exit`,
# which would close their window before they read why it stopped, and it puts back the settings it changes.
# It is a file run only when the file running is this installer (a pipe started from another script still counts as a pipe).
$script:SelfPath = $MyInvocation.MyCommand.Path
$script:FromPipe = -not ($script:SelfPath -and (Test-Path -LiteralPath $script:SelfPath) -and
    ((Get-Content -Raw -LiteralPath $script:SelfPath) -match 'boopis-install-stopped'))
$script:CallerErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ----------------------------------------------------------------------------------------------------------------------
# Where releases come from. Everything that names the project lives here and nowhere else.
# ----------------------------------------------------------------------------------------------------------------------
$Owner = 'aphesist'
$Repo = 'boopis'
$App = 'boopis'
# The file of a release. {v} is the version without its leading v.
$ArtifactWindows = 'boopis_{v}_x64-setup.exe'
$ChecksumsName = 'SHA256SUMS'
# The name the installer registers in Windows ("Apps and features"), and the Start menu entry it makes.
$RegisteredName = 'boopis'
$BaseUrl = 'https://github.com'
$ApiUrl = 'https://api.github.com'
if ($env:BOOPIS_BASE_URL) { $BaseUrl = $env:BOOPIS_BASE_URL }
if ($env:BOOPIS_API_URL) { $ApiUrl = $env:BOOPIS_API_URL }
# ----------------------------------------------------------------------------------------------------------------------

if (-not $Version -and $env:BOOPIS_VERSION) { $Version = $env:BOOPIS_VERSION }

# ---------------------------------------------------------------------------------------------------- the terminal ----

# What this console can show, in the same order as install.sh and the host: NO_COLOR, redirected output and a dumb
# terminal give plain text; Windows Terminal (and the terminals that say so) take colour and Unicode; a classic console
# gets plain text.
function Get-Terminal {
    $t = @{ Interactive = $false; Mode = 'mono'; Unicode = $false; Animate = $false; Cols = 80 }
    if ([Console]::IsOutputRedirected -or $env:TERM -eq 'dumb') { return $t }
    $t.Interactive = $true
    $vt = [bool]($env:WT_SESSION -or $env:ConEmuANSI -eq 'ON' -or $env:TERM_PROGRAM -eq 'vscode' -or $env:COLORTERM)
    if (-not $vt) { return $t }
    $t.Unicode = $true
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { $t.Unicode = $false }
    if (-not $NoColor -and -not $env:NO_COLOR) {
        $t.Mode = '256'
        if ($env:WT_SESSION -or $env:COLORTERM -match 'truecolor|24bit' -or $env:TERM_PROGRAM -eq 'vscode') { $t.Mode = 'truecolor' }
    }
    $t.Animate = [bool]($t.Unicode -and -not $env:CI -and (-not $env:BOOPIS_NO_ANIMATION -or $env:BOOPIS_NO_ANIMATION -eq '0'))
    try { $t.Cols = [Console]::WindowWidth } catch { $t.Cols = 80 }
    return $t
}

$script:Term = Get-Terminal
$script:Esc = [string][char]27
$script:Ok = ''; $script:Fail = ''; $script:Warn = ''; $script:Dim = ''; $script:Strong = ''; $script:Off = ''
$script:MarkOk = '+'; $script:MarkFail = 'x'; $script:MarkWarn = '!'

function Initialize-Style {
    if ($script:Term.Mode -ne 'mono') {
        $e = $script:Esc
        $script:Ok = "$e[$(Get-BoopisColor $script:Art 'moss' $script:Term.Mode)m"
        $script:Fail = "$e[$(Get-BoopisColor $script:Art 'nina' $script:Term.Mode)m"
        $script:Warn = "$e[$(Get-BoopisColor $script:Art 'terra' $script:Term.Mode)m"
        $script:Dim = "$e[2m"; $script:Strong = "$e[1m"; $script:Off = "$e[0m"
    }
    if ($script:Term.Unicode) {
        $script:MarkOk = [string][char]0x2713; $script:MarkFail = [string][char]0x2717
    }
}

# ---------------------------------------------------------------------------------------------------------- output ----

function Write-Line {
    param([string]$Text = '')
    if (-not $Quiet) { [Console]::Out.WriteLine($Text) }
}

function Write-Step {
    param([string]$Label, [string]$Detail, [string]$Kind = 'ok')
    if ($Quiet) { return }
    $mark = $script:MarkOk; $color = $script:Ok
    if ($Kind -eq 'warn') { $mark = $script:MarkWarn; $color = $script:Warn }
    $erase = ''
    if ($script:Term.Animate) { $erase = "`r$($script:Esc)[K" }
    [Console]::Out.WriteLine(('{0}  {1}{2}{3} {4,-13} {5}' -f $erase, $color, $mark, $script:Off, $Label, $Detail))
}

# Stop with a sentence that names the problem and one that names the way out. Nothing raw, never a stack. It does not
# `exit` here: the end of the script decides how to stop (an exit code for a file, a return for a pipe).
$script:StopMark = 'boopis-install-stopped'
function Stop-Install {
    param([string]$Problem, [string]$Next = '')
    if ($script:Term.Animate) { [Console]::Error.Write("`r$($script:Esc)[K") }
    [Console]::Error.WriteLine("  $($script:Fail)$($script:MarkFail)$($script:Off) $Problem")
    if ($Next) { [Console]::Error.WriteLine("    $Next") }
    throw $script:StopMark
}

function Format-Size { param([double]$Bytes) return ('{0:N1} MB' -f ($Bytes / 1MB)) }

function Format-Hash {
    param([string]$Hash)
    $dots = '...'
    if ($script:Term.Unicode) { $dots = [string][char]0x2026 }
    return $Hash.Substring(0, 12) + $dots + $Hash.Substring($Hash.Length - 6)
}

# The banner: the wordmark and the bots, with a short animation when the terminal allows it; otherwise the one-line logo.
function Show-Banner {
    if ($Quiet) { return }
    $t = $script:Term
    if ($t.Interactive -and $t.Unicode -and $t.Cols -ge 66) {
        [Console]::Out.WriteLine('')
        if ($t.Animate) {
            [Console]::Out.Write("$($script:Esc)[?25l")
            try { Show-BoopisScene $script:Art -Scene banner -Mode $t.Mode -Indent 2 -Play }
            finally { [Console]::Out.Write("$($script:Esc)[?25h") }
        }
        else { Show-BoopisScene $script:Art -Scene banner -Mode $t.Mode -Indent 2 }
        [Console]::Out.WriteLine('')
    }
    else {
        $name = 'boopis'
        if ($t.Interactive -and $t.Unicode) { $name = $script:Art.Texts['compact'] }
        [Console]::Out.WriteLine('')
        [Console]::Out.WriteLine("  $($script:Strong)$name$($script:Off) installer")
        [Console]::Out.WriteLine('')
    }
}

function Get-Bar {
    param([int]$Percent)
    $width = 28
    $fill = [int][math]::Floor($Percent * $width / 100)
    $full = [string][char]0x2588; $light = [string][char]0x2591
    return $script:Strong + ($full * $fill) + $script:Off + $script:Dim + ($light * ($width - $fill)) + $script:Off
}

# The box at the end: rounded when the console can draw it, plain otherwise.
function Show-Box {
    param([string[]]$Lines)
    if ($Quiet) { return }
    $tl = '+'; $tr = '+'; $bl = '+'; $br = '+'; $h = '-'; $v = '|'
    if ($script:Term.Interactive -and $script:Term.Unicode) {
        $tl = [string][char]0x256D; $tr = [string][char]0x256E; $bl = [string][char]0x2570; $br = [string][char]0x256F
        $h = [string][char]0x2500; $v = [string][char]0x2502
    }
    $width = ($Lines | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum + 2
    $rule = $h * $width
    [Console]::Out.WriteLine('')
    [Console]::Out.WriteLine("  $($script:Dim)$tl$rule$tr$($script:Off)")
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $pad = ' ' * ($width - 1 - $Lines[$i].Length)
        $text = $Lines[$i]
        if ($i -eq 1) { $text = "$($script:Strong)$text$($script:Off)" }
        [Console]::Out.WriteLine("  $($script:Dim)$v$($script:Off) $text$pad$($script:Dim)$v$($script:Off)")
    }
    [Console]::Out.WriteLine("  $($script:Dim)$bl$rule$br$($script:Off)")
    [Console]::Out.WriteLine('')
}

# ---------------------------------------------------------------------------------------------------- the release ----

function Get-ReleaseTag {
    if ($Version) {
        if ($Version.StartsWith('v')) { return $Version }
        return "v$Version"
    }
    # The latest release; while there is none yet (only pre-releases, which releases/latest leaves out), the newest
    # pre-release: GitHub lists releases newest first.
    $headers = @{ Accept = 'application/vnd.github+json' }
    try {
        $r = Invoke-RestMethod -Uri "$ApiUrl/repos/$Owner/$Repo/releases/latest" -Headers $headers -UseBasicParsing
        if ($r.tag_name) { return [string]$r.tag_name }
    }
    catch { }
    try {
        $list = @(Invoke-RestMethod -Uri "$ApiUrl/repos/$Owner/$Repo/releases" -Headers $headers -UseBasicParsing)
        if ($list.Count -gt 0 -and $list[0].tag_name) { return [string]$list[0].tag_name }
        throw 'no release'
    }
    catch {
        Stop-Install "boopis could not find the latest release of $Owner/$Repo." 'Check your connection, or name a release with -Version vX.Y.Z. If the repository is private, download the file by hand and use -File.'
    }
}

function Find-Uninstaller {
    foreach ($root in 'HKCU:', 'HKLM:') {
        $key = "$root\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegisteredName"
        if (Test-Path $key) { return Get-ItemProperty $key }
    }
    return $null
}

# ------------------------------------------------------------------------------------------------------------ steps ----

function Invoke-Uninstall {
    $entry = Find-Uninstaller
    if (-not $entry) {
        Stop-Install "boopis is not installed here: Windows has no entry named $RegisteredName." 'If it was installed another way, remove it from Settings > Apps.'
    }
    # A property the registry entry does not have is an error under strict mode, so ask for it by name.
    $quiet = $entry.PSObject.Properties['QuietUninstallString']
    if ($quiet -and $quiet.Value) { $cmd = [string]$quiet.Value }
    else { $cmd = [string]$entry.PSObject.Properties['UninstallString'].Value + ' /S' }
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$cmd`"" -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0) { Stop-Install "The uninstaller stopped with code $($p.ExitCode)." 'Remove boopis from Settings > Apps instead.' }
    Write-Step 'Removed' "$App, for this user"
    Write-Line ''
    Write-Line '  Your data in %APPDATA%\dev.aphesist.boopis was kept. Delete that folder to remove the runtime and the settings.'
    Write-Line ''
}

function Test-Download {
    param([string]$Path, [string]$Name, [string]$SumsPath)
    $actual = (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLower()
    $want = ''
    if ($Sha256) { $want = $Sha256.ToLower() }
    elseif ($SumsPath -and (Test-Path $SumsPath)) {
        foreach ($line in Get-Content $SumsPath) {
            $parts = $line -split '\s+', 2
            if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Name) { $want = $parts[0].ToLower() }
        }
        if (-not $want) { Stop-Install "$ChecksumsName has no line for $Name, so the file cannot be checked." 'Nothing was installed. Download the release again, or pass the hash yourself with -Sha256.' }
    }
    if ($want) {
        if ($want -ne $actual) {
            Stop-Install "The sha256 of $Name is not the one the release lists, so it was not installed." "Expected $want and got $actual. Download it again; if it happens twice, the file was changed on the way."
        }
        Write-Step 'Verified' "sha256 $(Format-Hash $actual)"
    }
    else {
        Write-Step 'Unchecked' "sha256 $(Format-Hash $actual) (a local file, with no checksums beside it)" 'warn'
    }
}

function Install-Boopis {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notin 'AMD64', 'ARM64') {
        Stop-Install 'boopis has no build for this processor.' 'Releases carry Windows x64.'
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $work = Join-Path ([IO.Path]::GetTempPath()) ("boopis-install-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work | Out-Null
    $job = $null
    try {
        $name = ''; $tag = ''; $installer = ''; $sums = ''
        if ($File) {
            if (-not (Test-Path $File)) { Stop-Install "There is no file at $File." 'Check the path, or leave out -File to download the latest release.' }
            $installer = (Resolve-Path $File).Path
            $name = Split-Path $installer -Leaf
            $sums = Join-Path (Split-Path $installer -Parent) $ChecksumsName
        }
        else {
            $tag = Get-ReleaseTag
            $name = $ArtifactWindows.Replace('{v}', $tag.TrimStart('v'))
            $url = "$BaseUrl/$Owner/$Repo/releases/download/$tag"
            $installer = Join-Path $work $name
            # The download starts now, under the banner: it is a job, so the animation never holds it up.
            $job = Start-Job -ScriptBlock {
                param($from, $to, $sumsFrom, $sumsTo)
                $ProgressPreference = 'SilentlyContinue'
                Invoke-WebRequest -Uri $from -OutFile ($to + '.part') -UseBasicParsing
                Move-Item ($to + '.part') $to
                Invoke-WebRequest -Uri $sumsFrom -OutFile $sumsTo -UseBasicParsing
            } -ArgumentList "$url/$name", $installer, "$url/$ChecksumsName", (Join-Path $work $ChecksumsName)
            $sums = Join-Path $work $ChecksumsName
        }
        Show-Banner
        Write-Step 'Platform' "windows $($env:PROCESSOR_ARCHITECTURE.ToLower())"
        if ($File) { Write-Step 'Source' $File }
        else {
            Write-Step 'Release' $tag
            $total = 0
            try { $total = [long](Invoke-WebRequest -Uri "$url/$name" -Method Head -UseBasicParsing).Headers['Content-Length'] } catch { $total = 0 }
            if ($Quiet) { Wait-Job $job | Out-Null }
            elseif (-not $script:Term.Animate) {
                $size = ''
                if ($total -gt 0) { $size = " ($(Format-Size $total))" }
                [Console]::Out.WriteLine(("  {0}{1}{2} {3,-13} {4}{5}" -f $script:Dim, [string][char]0xB7, $script:Off, 'Downloading', $name, $size))
            }
            while ($job.State -eq 'Running') {
                if ($script:Term.Animate) {
                    $have = 0
                    if (Test-Path ($installer + '.part')) { $have = (Get-Item ($installer + '.part')).Length }
                    if ($total -gt 0) {
                        $pct = [int][math]::Min(100, [math]::Floor($have * 100 / $total))
                        [Console]::Out.Write(("`r$($script:Esc)[K  {0}{1}{2} {3,-13} {4} {5,3}%  {6} of {7}" -f $script:Dim, [string][char]0xB7, $script:Off, 'Downloading', (Get-Bar $pct), $pct, (Format-Size $have), (Format-Size $total)))
                    }
                    else {
                        [Console]::Out.Write(("`r$($script:Esc)[K  {0}{1}{2} {3,-13} {4}" -f $script:Dim, [string][char]0xB7, $script:Off, 'Downloading', (Format-Size $have)))
                    }
                }
                Start-Sleep -Milliseconds 100
            }
            try { Receive-Job $job -ErrorAction Stop | Out-Null }
            catch { Stop-Install "boopis could not download $name from release $tag." "Check that the release exists and has that file, or name another with -Version. Address: $url/$name" }
            if (-not (Test-Path $sums)) { Stop-Install "The release $tag has no $ChecksumsName, so the download cannot be checked." 'Nothing was installed. Ask the maintainers to attach the checksums to the release.' }
            Write-Step 'Downloaded' "$name ($(Format-Size (Get-Item $installer).Length))"
        }
        Test-Download -Path $installer -Name $name -SumsPath $sums

        # The installer is an NSIS setup: /S is silent, and it installs for the current user, so there is no prompt and
        # no administrator rights. An older install is replaced by the same setup.
        $p = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
        if ($p.ExitCode -ne 0) { Stop-Install "The installer stopped with code $($p.ExitCode), so boopis was not installed." 'Run it again without -Quiet, or run the downloaded setup by hand to see its own message.' }
        $entry = Find-Uninstaller
        $where = 'the Start menu'
        if ($entry -and $entry.PSObject.Properties['InstallLocation']) { $where = [string]$entry.InstallLocation }
        Write-Step 'Installed' $where
        Write-Step 'Registered' 'Start menu entry and Apps and features'
        Show-Box @('', "$App is ready", '', "Start it    from the Start menu ($RegisteredName)", 'Remove it   .\install.ps1 -Uninstall', '')
    }
    finally {
        if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
        Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
    }
}

# >>> brand (generated by scripts/embed-brand.sh from packaging/brand; edit those files, not this block)
$BoopisArtText = @'
# boopis terminal art. One file: every renderer reads it (packaging/AGENTS.md).
# Pixels are half a cell wide and half a cell tall (a cell is 2x2 pixels, drawn with quadrant blocks).
#   color <name> <#rrggbb | -> [hole]   '-' is the terminal's own foreground; a hole is not drawn without colour
#   sprite <name> <color> ... end        '#' is the sprite's colour, 'o' the eye colour, '.' nothing
#   text <name> <string>                 a one-line form
#   scene <name> ... end                 slot <slot> <x> <y> <sprite>, in pixels
#   anim <scene> ... end                 frame <ms> <slot>=<sprite>[@dy] ..., dy in pixels (up is negative)
format 1

color ink -
color eye #0f0e0c hole
color kai #4fc9a8
color nina #f23b5a
color iris #3b82f6
color hex #a6a6ab
color nimbus #9b5cf6
color moss #2fd26a
color terra #c4834a

text compact b{U+25CF}{U+25CF}pis
text compact.ascii boopis

sprite logo ink
#####............................................................................................#####......................
#####............................................................................................#####......................
#####............................................................................................#####......................
#####.......................................................................................................................
#####...########.........................................................####...########.........#####........##########....
##################......................................................##################.......#####.....################.
######.......######.....................................................######........######.....#####....#####........###..
#####.........######....................................................######.........#####.....#####....#####.............
#####..........#####....................................................######.........#####.....#####.....##########.......
#####..........#####....................................................######.........######....#####......##############..
#####..........#####....................................................######.........#####.....#####............#########.
#####.........######....................................................######.........#####.....#####.................#####
######.......######.....................................................######.......######......#####....####.........#####
####.#############......................................................##################.......#####.....################.
####...########.........................................................######..########.........#####........##########....
........................................................................######..............................................
........................................................................######..............................................
........................................................................######..............................................
end

sprite eyes.idle ink
........###########.............###########.......
......################........################....
....###################.....###################...
....####################....####################..
...#####################...#####################..
...#####################...#####################..
...#####################...#####################..
....####################....####################..
....###################.....###################...
......################........################....
.........##########..............##########.......
..................................................
end

sprite eyes.blink ink
..................................................
..................................................
..................................................
..................................................
........############............############......
...#####################...#####################..
..........########................########........
..................................................
..................................................
..................................................
..................................................
..................................................
end

sprite eyes.left ink
.......###########.............###########........
.....################........################.....
...###################.....###################....
...####################....####################...
..#####################...#####################...
..#####################...#####################...
..#####################...#####################...
...####################....####################...
...###################.....###################....
.....################........################.....
........##########..............##########........
..................................................
end

sprite eyes.right ink
.........###########.............###########......
.......################........################...
.....###################.....###################..
.....####################....####################.
....#####################...#####################.
....#####################...#####################.
....#####################...#####################.
.....####################....####################.
.....###################.....###################..
.......################........################...
..........##########..............##########......
..................................................
end

sprite bot.kai.idle kai
...######...
.##########.
###oo##oo###
###oo##oo###
.##########.
...######...
end

sprite bot.kai.blink kai
...######...
.##########.
############
###oo##oo###
.##########.
...######...
end

sprite bot.kai.left kai
...######...
.##########.
##oo##oo####
##oo##oo####
.##########.
...######...
end

sprite bot.kai.right kai
...######...
.##########.
####oo##oo##
####oo##oo##
.##########.
...######...
end

sprite bot.nina.idle nina
.....##.....
....####....
...######...
..#oo##oo#..
.##oo##oo##.
############
end

sprite bot.nina.blink nina
.....##.....
....####....
...######...
..########..
.##oo##oo##.
############
end

sprite bot.nina.left nina
.....##.....
....####....
...######...
..oo##oo##..
.#oo##oo###.
############
end

sprite bot.nina.right nina
.....##.....
....####....
...######...
..##oo##oo..
.###oo##oo#.
############
end

sprite bot.iris.idle iris
.....##.....
....####....
...######...
.##oo##oo##.
###oo##oo###
..########..
end

sprite bot.iris.blink iris
.....##.....
....####....
...######...
.##########.
###oo##oo###
..########..
end

sprite bot.iris.left iris
.....##.....
....####....
...######...
.#oo##oo###.
##oo##oo####
..########..
end

sprite bot.iris.right iris
.....##.....
....####....
...######...
.###oo##oo#.
####oo##oo##
..########..
end

sprite bot.hex.idle hex
....####....
..########..
###oo##oo###
###oo##oo###
..########..
....####....
end

sprite bot.hex.blink hex
....####....
..########..
############
###oo##oo###
..########..
....####....
end

sprite bot.hex.left hex
....####....
..########..
##oo##oo####
##oo##oo####
..########..
....####....
end

sprite bot.hex.right hex
....####....
..########..
####oo##oo##
####oo##oo##
..########..
....####....
end

sprite bot.nimbus.idle nimbus
..###..###..
.##########.
############
#oooo##oooo#
############
.##########.
end

sprite bot.nimbus.blink nimbus
..###..###..
.##########.
############
#oooo##oooo#
############
.##########.
end

sprite bot.nimbus.left nimbus
..###..###..
.##########.
############
oooo##oooo##
############
.##########.
end

sprite bot.nimbus.right nimbus
..###..###..
.##########.
############
##oooo##oooo
############
.##########.
end

sprite bot.moss.idle moss
.##########.
############
####o##o####
####o##o####
############
.##########.
end

sprite bot.moss.blink moss
.##########.
############
############
####o##o####
############
.##########.
end

sprite bot.moss.left moss
.##########.
############
###o##o#####
###o##o#####
############
.##########.
end

sprite bot.moss.right moss
.##########.
############
#####o##o###
#####o##o###
############
.##########.
end

scene banner
slot logo 0 0 logo
slot eyes 20 4 eyes.idle
slot kai 0 22 bot.kai.idle
slot nina 22 22 bot.nina.idle
slot iris 44 22 bot.iris.idle
slot hex 66 22 bot.hex.idle
slot nimbus 88 22 bot.nimbus.idle
slot moss 110 22 bot.moss.idle
end

scene bots
slot kai 0 2 bot.kai.idle
slot nina 22 2 bot.nina.idle
slot iris 44 2 bot.iris.idle
slot hex 66 2 bot.hex.idle
slot nimbus 88 2 bot.nimbus.idle
slot moss 110 2 bot.moss.idle
end

anim banner
frame 90 eyes=eyes.blink kai=bot.kai.blink nina=bot.nina.blink iris=bot.iris.blink hex=bot.hex.blink nimbus=bot.nimbus.blink moss=bot.moss.blink
frame 130 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 170 eyes=eyes.left kai=bot.kai.left nina=bot.nina.left iris=bot.iris.left hex=bot.hex.left nimbus=bot.nimbus.left moss=bot.moss.left
frame 170 eyes=eyes.right kai=bot.kai.right nina=bot.nina.right iris=bot.iris.right hex=bot.hex.right nimbus=bot.nimbus.right moss=bot.moss.right
frame 90 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle@-1 nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle@-2 nina=bot.nina.idle@-1 iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle@-1 nina=bot.nina.idle@-2 iris=bot.iris.idle@-1 hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle@-1 iris=bot.iris.idle@-2 hex=bot.hex.idle@-1 nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle@-1 hex=bot.hex.idle@-2 nimbus=bot.nimbus.idle@-1 moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle@-1 nimbus=bot.nimbus.idle@-2 moss=bot.moss.idle@-1
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle@-1 moss=bot.moss.idle@-2
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle@-1
frame 1 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
end
'@
# The boopis terminal art renderer for PowerShell (Windows PowerShell 5.1 and PowerShell 7). It draws a scene exactly as
# the host's renderer does (apps/desktop/src-tauri/src/brand.rs) and as render.awk does: the goldens in
# packaging/brand/golden/ are what all three print. scripts/embed-brand.sh copies this file into scripts/install.ps1.
#
# This file is ASCII on purpose: a script read without a byte-order mark is read as ANSI by Windows PowerShell 5.1.
# Characters outside ASCII are spelled as code points, and the art's one non-ASCII character is spelled {U+25CF}.
#
#   $art  = ConvertFrom-BoopisArt $BoopisArtText
#   $rows = Get-BoopisScene $art -Scene banner -Frame -1 -Mode truecolor    # -1 is the scene as written; Mode: truecolor, 256, 16, mono
#   Show-BoopisScene $art -Scene banner -Mode truecolor -Indent 2 -Play     # draw it and play its animation in place

$script:BoopisEsc = [string][char]27
$script:BoopisQuadrants = @(' ') + @(0x2598, 0x259D, 0x2580, 0x2596, 0x258C, 0x259E, 0x259B, 0x2597, 0x259A, 0x2590, 0x259C, 0x2584, 0x2599, 0x259F, 0x2588 | ForEach-Object { [string][char]$_ })
$script:BoopisCube = @(0, 95, 135, 175, 215, 255)
$script:BoopisAnsi16 = @(
    @(0, 0, 0), @(205, 0, 0), @(0, 205, 0), @(205, 205, 0), @(0, 0, 238), @(205, 0, 205), @(0, 205, 205), @(229, 229, 229),
    @(127, 127, 127), @(255, 0, 0), @(0, 255, 0), @(255, 255, 0), @(92, 92, 255), @(255, 0, 255), @(0, 255, 255), @(255, 255, 255)
)

function ConvertFrom-BoopisArt {
    param([string]$Text)
    $Text = [regex]::Replace($Text, '\{U\+([0-9A-Fa-f]{4})\}', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
    $art = @{ Colors = @(); Eye = -1; Sprites = @{}; Texts = @{}; Scenes = @{}; Anims = @{} }
    $lines = $Text -split "`r?`n"
    $i = 0
    while ($i -lt $lines.Count) {
        $line = $lines[$i].TrimEnd()
        $i++
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $w = $line -split ' '
        if ($w[0] -eq 'color') {
            $rgb = $null
            if ($w[2] -ne '-') {
                $rgb = @([Convert]::ToInt32($w[2].Substring(1, 2), 16), [Convert]::ToInt32($w[2].Substring(3, 2), 16), [Convert]::ToInt32($w[2].Substring(5, 2), 16))
            }
            $hole = ($w.Count -gt 3 -and $w[3] -eq 'hole')
            $art.Colors += , @{ Name = $w[1]; Rgb = $rgb; Hole = $hole }
            if ($hole) { $art.Eye = $art.Colors.Count - 1 }
        }
        elseif ($w[0] -eq 'text') {
            $art.Texts[$w[1]] = ($line -split ' ', 3)[2]
        }
        elseif ($w[0] -eq 'sprite') {
            $color = 0
            for ($c = 0; $c -lt $art.Colors.Count; $c++) { if ($art.Colors[$c].Name -eq $w[2]) { $color = $c } }
            $rows = @()
            while ($lines[$i].TrimEnd() -ne 'end') { $rows += $lines[$i].TrimEnd(); $i++ }
            $i++
            $art.Sprites[$w[1]] = @{ Color = $color; Width = $rows[0].Length; Rows = $rows }
        }
        elseif ($w[0] -eq 'scene') {
            $slots = @()
            while ($lines[$i].Trim() -ne 'end') {
                $p = $lines[$i].Trim() -split ' '
                $slots += , @{ Name = $p[1]; X = [int]$p[2]; Y = [int]$p[3]; Sprite = $p[4] }
                $i++
            }
            $i++
            $art.Scenes[$w[1]] = $slots
        }
        elseif ($w[0] -eq 'anim') {
            $frames = @()
            while ($lines[$i].Trim() -ne 'end') {
                $p = $lines[$i].Trim() -split ' '
                $poses = @()
                for ($k = 2; $k -lt $p.Count; $k++) {
                    $eq = $p[$k].IndexOf('=')
                    $slot = $p[$k].Substring(0, $eq)
                    $rest = $p[$k].Substring($eq + 1)
                    $at = $rest.IndexOf('@')
                    if ($at -ge 0) { $sprite = $rest.Substring(0, $at); $dy = [int]$rest.Substring($at + 1) } else { $sprite = $rest; $dy = 0 }
                    $poses += , @{ Slot = $slot; Sprite = $sprite; Dy = $dy }
                }
                $frames += , @{ Ms = [int]$p[1]; Poses = $poses }
                $i++
            }
            $i++
            $art.Anims[$w[1]] = $frames
        }
    }
    return $art
}

# The nearest of the xterm 256 palette: the colour cube or the grey ramp, the cube on a tie.
function Get-BoopisNearest256 {
    param([int]$R, [int]$G, [int]$B)
    $cube = $script:BoopisCube
    $level = {
        param($v)
        $best = 0
        for ($i = 1; $i -lt 6; $i++) { if ([math]::Abs($v - $cube[$i]) -lt [math]::Abs($v - $cube[$best])) { $best = $i } }
        return $best
    }
    $ri = & $level $R
    $gi = & $level $G
    $bi = & $level $B
    $cd = [math]::Pow($R - $cube[$ri], 2) + [math]::Pow($G - $cube[$gi], 2) + [math]::Pow($B - $cube[$bi], 2)
    $gd = [double]::MaxValue
    $gk = 0
    for ($i = 0; $i -lt 24; $i++) {
        $v = 8 + 10 * $i
        $d = [math]::Pow($R - $v, 2) + [math]::Pow($G - $v, 2) + [math]::Pow($B - $v, 2)
        if ($d -lt $gd) { $gd = $d; $gk = $i }
    }
    if ($cd -le $gd) { return 16 + 36 * $ri + 6 * $gi + $bi }
    return 232 + $gk
}

# The nearest of the 16 default colours (the lower on a tie).
function Get-BoopisNearest16 {
    param([int]$R, [int]$G, [int]$B)
    $best = 0
    $bd = [double]::MaxValue
    for ($i = 0; $i -lt 16; $i++) {
        $c = $script:BoopisAnsi16[$i]
        $d = [math]::Pow($R - $c[0], 2) + [math]::Pow($G - $c[1], 2) + [math]::Pow($B - $c[2], 2)
        if ($d -lt $bd) { $bd = $d; $best = $i }
    }
    return $best
}

# The SGR parameters that set the colour "r,g,b" as a foreground (or a background), at a level.
function Get-BoopisSgrCode {
    param([string]$Rgb, [bool]$Foreground, [string]$Mode)
    $p = $Rgb -split ','
    $r = [int]$p[0]; $g = [int]$p[1]; $b = [int]$p[2]
    $plane = 48
    if ($Foreground) { $plane = 38 }
    if ($Mode -eq 'truecolor') { return "$plane;2;$r;$g;$b" }
    if ($Mode -eq '256') { return "$plane;5;$(Get-BoopisNearest256 $r $g $b)" }
    $i = Get-BoopisNearest16 $r $g $b
    $base = 40
    if ($Foreground) { $base = 30 }
    if ($i -lt 8) { return [string]($base + $i) }
    return [string]($base + 60 + $i - 8)
}

# The SGR parameters of a palette colour, as a foreground (the check marks).
function Get-BoopisColor {
    param($Art, [string]$Name, [string]$Mode)
    foreach ($c in $Art.Colors) {
        if ($c.Name -eq $Name -and $null -ne $c.Rgb) { return (Get-BoopisSgrCode ($c.Rgb -join ',') $true $Mode) }
    }
    return ''
}

# The scene as lines of text: frame -1 as written, N the Nth animation frame (from 0).
function Get-BoopisScene {
    param($Art, [string]$Scene = 'banner', [int]$Frame = -1, [string]$Mode = 'mono', [int]$Indent = 0)
    $esc = $script:BoopisEsc
    $slots = $Art.Scenes[$Scene]
    $w = 0; $h = 0
    foreach ($s in $slots) {
        $sp = $Art.Sprites[$s.Sprite]
        $w = [math]::Max($w, $s.X + $sp.Width)
        $h = [math]::Max($h, $s.Y + $sp.Rows.Count)
    }
    $w += $w % 2; $h += $h % 2
    $cv = New-Object 'int[,]' $h, $w
    foreach ($s in $slots) {
        $name = $s.Sprite; $dy = 0
        if ($Frame -ge 0) {
            foreach ($p in $Art.Anims[$Scene][$Frame].Poses) { if ($p.Slot -eq $s.Name) { $name = $p.Sprite; $dy = $p.Dy } }
        }
        $sp = $Art.Sprites[$name]
        for ($y = 0; $y -lt $sp.Rows.Count; $y++) {
            $py = $s.Y + $y + $dy
            if ($py -lt 0 -or $py -ge $h) { continue }
            $row = $sp.Rows[$y]
            for ($x = 0; $x -lt $sp.Width; $x++) {
                if ($s.X + $x -ge $w) { continue }
                $ch = $row.Substring($x, 1)
                if ($ch -eq '#') { $cv[$py, ($s.X + $x)] = $sp.Color + 1 }
                elseif ($ch -eq 'o') { $cv[$py, ($s.X + $x)] = $Art.Eye + 1 }
            }
        }
    }
    $rgbOf = {
        param($ci)
        if ($ci -lt 0) { return '' }
        $c = $Art.Colors[$ci]
        if ($null -eq $c.Rgb) { return '' }
        return ($c.Rgb -join ',')
    }
    $pw = @(1, 2, 4, 8)
    $prefix = ' ' * $Indent
    $out = @()
    for ($r = 0; $r -lt ($h -shr 1); $r++) {
        $cells = @()
        for ($c = 0; $c -lt ($w -shr 1); $c++) {
            $em = 0; $bm = 0; $body = 0
            for ($i = 0; $i -lt 4; $i++) {
                $v = $cv[($r * 2 + ($i -shr 1)), ($c * 2 + ($i -band 1))]
                if ($v -eq 0) { continue }
                if ($Art.Eye -ge 0 -and $v -eq $Art.Eye + 1) { $em += $pw[$i] }
                else { $bm += $pw[$i]; if ($body -eq 0) { $body = $v } }
            }
            $cell = @{ Ch = $script:BoopisQuadrants[$bm]; Fg = ''; Bg = '' }
            if ($Mode -ne 'mono') {
                if ($em -eq 0) { $cell.Ch = $script:BoopisQuadrants[$bm]; $cell.Fg = & $rgbOf ($body - 1) }
                elseif ($bm -eq 0) { $cell.Ch = $script:BoopisQuadrants[$em]; $cell.Fg = & $rgbOf $Art.Eye }
                else { $cell.Ch = $script:BoopisQuadrants[$em]; $cell.Fg = & $rgbOf $Art.Eye; $cell.Bg = & $rgbOf ($body - 1) }
            }
            $cells += , $cell
        }
        $last = $cells.Count
        while ($last -gt 0 -and $cells[$last - 1].Ch -eq ' ' -and $cells[$last - 1].Bg -eq '') { $last-- }
        $sb = New-Object System.Text.StringBuilder
        $stFg = ''; $stBg = ''
        for ($c = 0; $c -lt $last; $c++) {
            $cell = $cells[$c]
            if ($Mode -ne 'mono') {
                $blank = ($cell.Ch -eq ' ' -and $cell.Bg -eq '')
                if ($blank) { $wantFg = ''; $wantBg = ''; $need = ($stBg -ne '') }
                else { $wantFg = $cell.Fg; $wantBg = $cell.Bg; $need = ($stFg -ne $wantFg -or $stBg -ne $wantBg) }
                if ($need) {
                    $codes = '0'
                    if ($wantFg -ne '') { $codes += ';' + (Get-BoopisSgrCode $wantFg $true $Mode) }
                    if ($wantBg -ne '') { $codes += ';' + (Get-BoopisSgrCode $wantBg $false $Mode) }
                    [void]$sb.Append("$esc[${codes}m")
                    $stFg = $wantFg; $stBg = $wantBg
                }
            }
            [void]$sb.Append($cell.Ch)
        }
        if ($stFg -ne '' -or $stBg -ne '') { [void]$sb.Append("$esc[0m") }
        $line = $sb.ToString()
        if ($line -ne '') { $line = $prefix + $line }
        $out += $line
    }
    return , $out
}

# Draw a scene; with -Play, then play its animation in place (about a second): each frame moves the cursor back up over
# the picture and draws on top of it, clearing to the end of each line.
function Show-BoopisScene {
    param($Art, [string]$Scene = 'banner', [string]$Mode = 'mono', [int]$Indent = 0, [switch]$Play)
    $esc = $script:BoopisEsc
    $lines = Get-BoopisScene $Art -Scene $Scene -Frame -1 -Mode $Mode -Indent $Indent
    foreach ($l in $lines) { [Console]::Out.WriteLine($l) }
    if (-not $Play) { return }
    $frames = $Art.Anims[$Scene]
    for ($f = 0; $f -lt $frames.Count; $f++) {
        Start-Sleep -Milliseconds $frames[$f].Ms
        $lines = Get-BoopisScene $Art -Scene $Scene -Frame $f -Mode $Mode -Indent $Indent
        [Console]::Out.Write("$esc[$($lines.Count)A")
        foreach ($l in $lines) { [Console]::Out.WriteLine($l + "$esc[K") }
    }
}
# <<< brand

$script:Failed = $false
try {
    $script:Art = ConvertFrom-BoopisArt $BoopisArtText
    Initialize-Style
    if ($Uninstall) {
        Show-Banner
        Invoke-Uninstall
    }
    else {
        Install-Boopis
    }
}
catch {
    $script:Failed = $true
    # Stop-Install already said what went wrong and what to do; anything else is said in one sentence, never a stack
    if ([string]$_.Exception.Message -ne $script:StopMark) {
        [Console]::Error.WriteLine("  boopis could not finish: $($_.Exception.Message)")
        [Console]::Error.WriteLine("    Run it again. If it stops here again, report it at $BaseUrl/$Owner/$Repo/issues")
    }
}
finally {
    if ($script:FromPipe) {
        Set-StrictMode -Off
        $ErrorActionPreference = $script:CallerErrorAction
    }
}
if ($script:Failed) {
    if ($script:FromPipe) { $global:LASTEXITCODE = 1 } else { exit 1 }
}
