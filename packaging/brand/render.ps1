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
