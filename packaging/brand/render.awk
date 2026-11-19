# The boopis terminal art renderer for POSIX awk (Linux and macOS). It reads packaging/brand/boopis.art on standard
# input and draws a scene exactly as the host's renderer does (apps/desktop/src-tauri/src/brand.rs): the goldens in
# packaging/brand/golden/ are what both must print. scripts/embed-brand.sh copies this file into scripts/install.sh.
#
#   -v mode=truecolor|256|16|mono   the colour level (mono: no escape codes, the eyes are holes)
#   -v scene=banner                 the scene to draw
#   -v frame=-1                     -1: the scene as written, N: animation frame N (counted from 0)
#   -v play=1                       draw the scene, then play its animation in place (about a second)
#   -v indent=2                     spaces in front of every line
#   -v text=compact                 print a text entry instead (the one-line logo)
#   -v color=moss                   print the SGR parameters of a palette colour as a foreground (the check marks)
#
# A cell is 2x2 pixels, drawn with the quadrant blocks. Only POSIX awk is used (no gensub, no length of an array).

function hexval(h,   i, v, c) {
    v = 0
    for (i = 1; i <= length(h); i++) {
        c = index("0123456789abcdef", tolower(substr(h, i, 1))) - 1
        v = v * 16 + c
    }
    return v
}
function abs(v) { return v < 0 ? -v : v }
function sq(v) { return v * v }

# the nearest of the xterm 256 palette: the colour cube or the grey ramp, the cube on a tie
function level(v,   i, best) {
    best = 0
    for (i = 1; i < 6; i++) if (abs(v - cube[i]) < abs(v - cube[best])) best = i
    return best
}
function nearest256(r, g, b,   ri, gi, bi, cd, i, v, d, gd, gi2) {
    ri = level(r); gi = level(g); bi = level(b)
    cd = sq(r - cube[ri]) + sq(g - cube[gi]) + sq(b - cube[bi])
    gd = 2147483647; gi2 = 0
    for (i = 0; i < 24; i++) {
        v = 8 + 10 * i
        d = sq(r - v) + sq(g - v) + sq(b - v)
        if (d < gd) { gd = d; gi2 = i }
    }
    if (cd <= gd) return 16 + 36 * ri + 6 * gi + bi
    return 232 + gi2
}
function nearest16(r, g, b,   i, d, best, bd) {
    bd = 2147483647; best = 0
    for (i = 0; i < 16; i++) {
        d = sq(r - a16r[i]) + sq(g - a16g[i]) + sq(b - a16b[i])
        if (d < bd) { bd = d; best = i }
    }
    return best
}
# the SGR parameters that set the colour "r,g,b" as foreground (fg=1) or background
function sgr(rgb, fg,   p, plane, i, base) {
    split(rgb, p, ",")
    plane = fg ? 38 : 48
    if (mode == "truecolor") return sprintf("%d;2;%d;%d;%d", plane, p[1], p[2], p[3])
    if (mode == "256") return sprintf("%d;5;%d", plane, nearest256(p[1] + 0, p[2] + 0, p[3] + 0))
    i = nearest16(p[1] + 0, p[2] + 0, p[3] + 0)
    base = fg ? 30 : 40
    return sprintf("%d", i < 8 ? base + i : base + 60 + i - 8)
}
function rgbof(ci) {          # "r,g,b", or "" for the terminal's own foreground
    if (ci < 0 || !hasrgb[ci]) return ""
    return cr[ci] "," cg[ci] "," cb[ci]
}

function compose(f,   k, name, sp, dy, j, y, x, c, py, W, H, px) {
    W = 0; H = 0
    for (k = 1; k <= nslot[scene]; k++) {
        sp = slsp[scene, k]
        if (slx[scene, k] + spw[sp] > W) W = slx[scene, k] + spw[sp]
        if (sly[scene, k] + sph[sp] > H) H = sly[scene, k] + sph[sp]
    }
    cw = W + W % 2; ch = H + H % 2
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) cv[y, x] = 0
    for (k = 1; k <= nslot[scene]; k++) {
        name = slsp[scene, k]; dy = 0
        if (f >= 0) for (j = 1; j <= frn[scene, f]; j++)
            if (frslot[scene, f, j] == slname[scene, k]) { name = frsp[scene, f, j]; dy = frdy[scene, f, j] }
        for (y = 0; y < sph[name]; y++) {
            py = sly[scene, k] + y + dy
            if (py < 0 || py >= ch) continue
            for (x = 0; x < spw[name]; x++) {
                c = substr(spr[name, y], x + 1, 1)
                if (slx[scene, k] + x >= cw) continue
                if (c == "#") cv[py, slx[scene, k] + x] = spcol[name] + 1
                else if (c == "o") cv[py, slx[scene, k] + x] = eyec + 1
            }
        }
    }
}

# draw the composed canvas into lines[1..nl]
function draw(   r, c, i, v, em, bm, body, n, ncell, ch1, fg, bg, row, st_fg, st_bg, blank, want_fg, want_bg, need, codes, last) {
    nl = ch / 2
    for (r = 0; r < ch / 2; r++) {
        ncell = cw / 2
        for (c = 0; c < ncell; c++) {
            em = 0; bm = 0; body = 0
            for (i = 0; i < 4; i++) {
                v = cv[r * 2 + int(i / 2), c * 2 + i % 2]
                if (v == 0) continue
                if (eyec >= 0 && v == eyec + 1) em += pw[i]
                else { bm += pw[i]; if (body == 0) body = v }
            }
            cch[c] = ""; cfg[c] = ""; cbg[c] = ""
            if (mode == "mono") { cch[c] = q[bm]; continue }
            if (em == 0)      { cch[c] = q[bm]; cfg[c] = rgbof(body - 1) }
            else if (bm == 0) { cch[c] = q[em]; cfg[c] = rgbof(eyec) }
            else              { cch[c] = q[em]; cfg[c] = rgbof(eyec); cbg[c] = rgbof(body - 1) }
        }
        last = ncell
        while (last > 0 && cch[last - 1] == " " && cbg[last - 1] == "") last--
        row = ""; st_fg = ""; st_bg = ""
        for (c = 0; c < last; c++) {
            if (mode != "mono") {
                blank = (cch[c] == " " && cbg[c] == "")
                want_fg = blank ? "" : cfg[c]; want_bg = blank ? "" : cbg[c]
                need = blank ? (st_bg != "") : (st_fg != want_fg || st_bg != want_bg)
                if (need) {
                    codes = "0"
                    if (want_fg != "") codes = codes ";" sgr(want_fg, 1)
                    if (want_bg != "") codes = codes ";" sgr(want_bg, 0)
                    row = row ESC "[" codes "m"
                    st_fg = want_fg; st_bg = want_bg
                }
            }
            row = row cch[c]
        }
        if (st_fg != "" || st_bg != "") row = row ESC "[0m"
        lines[r + 1] = row
    }
}

function show(clear,   i) {
    for (i = 1; i <= nl; i++) {
        if (lines[i] != "") printf "%s%s", sp2, lines[i]
        if (clear) printf "%s[K", ESC
        printf "\n"
    }
}

BEGIN {
    ESC = sprintf("%c", 27)
    if (mode == "") mode = "mono"
    if (scene == "") scene = "banner"
    if (frame == "") frame = -1
    frame += 0
    sp2 = sprintf("%*s", indent + 0, "")
    q[0] = " "; q[1] = "▘"; q[2] = "▝"; q[3] = "▀"; q[4] = "▖"; q[5] = "▌"; q[6] = "▞"; q[7] = "▛"
    q[8] = "▗"; q[9] = "▚"; q[10] = "▐"; q[11] = "▜"; q[12] = "▄"; q[13] = "▙"; q[14] = "▟"; q[15] = "█"
    pw[0] = 1; pw[1] = 2; pw[2] = 4; pw[3] = 8
    cube[0] = 0; cube[1] = 95; cube[2] = 135; cube[3] = 175; cube[4] = 215; cube[5] = 255
    split("0 205 0 205 0 205 0 229 127 255 0 255 92 255 0 255", t16r, " ")
    split("0 0 205 205 0 0 205 229 127 0 255 255 92 0 255 255", t16g, " ")
    split("0 0 0 0 238 205 205 229 127 0 0 0 255 255 255 255", t16b, " ")
    for (i = 0; i < 16; i++) { a16r[i] = t16r[i + 1]; a16g[i] = t16g[i + 1]; a16b[i] = t16b[i + 1] }
    ncol = 0; eyec = -1; st = ""
}
{
    sub(/\r$/, "")
    if (st == "sprite") {
        if ($0 == "end") { st = ""; next }
        spr[cur, sph[cur]++] = $0; spw[cur] = length($0)
        next
    }
    if (st == "scene") {
        if ($1 == "end") { st = ""; next }
        n = ++nslot[cur]
        slname[cur, n] = $2; slx[cur, n] = $3 + 0; sly[cur, n] = $4 + 0; slsp[cur, n] = $5
        next
    }
    if (st == "anim") {
        if ($1 == "end") { st = ""; next }
        f = nfr[cur]++
        frn[cur, f] = 0
        for (i = 3; i <= NF; i++) {
            eq = index($i, "=")
            rest = substr($i, eq + 1)
            at = index(rest, "@")
            j = ++frn[cur, f]
            frslot[cur, f, j] = substr($i, 1, eq - 1)
            frsp[cur, f, j] = at ? substr(rest, 1, at - 1) : rest
            frdy[cur, f, j] = at ? substr(rest, at + 1) + 0 : 0
        }
        frms[cur, f] = $2 + 0
        next
    }
    if ($0 == "" || substr($0, 1, 1) == "#") next
    if ($1 == "color") {
        i = ncol++
        cname[i] = $2
        if ($3 == "-") hasrgb[i] = 0
        else { hasrgb[i] = 1; cr[i] = hexval(substr($3, 2, 2)); cg[i] = hexval(substr($3, 4, 2)); cb[i] = hexval(substr($3, 6, 2)) }
        if ($4 == "hole") eyec = i
        cidx[$2] = i
    } else if ($1 == "text") {
        texts[$2] = substr($0, index($0, $3))
    } else if ($1 == "sprite") {
        cur = $2; spcol[cur] = cidx[$3]; sph[cur] = 0; st = "sprite"
    } else if ($1 == "scene") {
        cur = $2; nslot[cur] = 0; st = "scene"
    } else if ($1 == "anim") {
        cur = $2; nfr[cur] = 0; st = "anim"
    }
}
END {
    if (text != "") { print texts[text]; exit }
    if (color != "") { print sgr(rgbof(cidx[color]), 1); exit }
    compose(frame)
    draw()
    show(0)
    if (play) {
        for (f = 0; f < nfr[scene]; f++) {
            fflush()
            system("sleep " sprintf("%.3f", frms[scene, f] / 1000) " 2>/dev/null")
            compose(f)
            draw()
            printf "%s[%dA", ESC, nl
            show(1)
        }
        fflush()
    }
}
