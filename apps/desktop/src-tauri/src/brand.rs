//! The terminal art: the wordmark, the bots and the one-line logo, read from `packaging/brand/boopis.art`.
//!
//! The art exists once, as data (`packaging/brand/AGENTS.md` has the format). This is the reference renderer. The
//! installers cannot link Rust, so `scripts/install.sh` (awk) and `scripts/install.ps1` (PowerShell) carry a renderer
//! of their own, generated into them from `packaging/brand/render.awk` and `render.ps1`; the golden files in
//! `packaging/brand/golden/` are what all three must produce byte for byte (`scripts/test-brand.sh` checks the awk one).
//!
//! A cell is 2x2 pixels, drawn with the quadrant blocks (the way Claude Code's welcome banner is). A pixel is half a
//! cell wide and half a cell tall. Colour comes in four levels (truecolor, 256, 16, none), picked by [`Caps::detect`]
//! from the environment, never assumed.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::OnceLock;

/// The art, as shipped.
pub const ART: &str = include_str!("../../../../packaging/brand/boopis.art");

/// The quadrant blocks by pixel mask: 1 top left, 2 top right, 4 bottom left, 8 bottom right.
const QUADRANTS: [char; 16] = [
    ' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█',
];

/// The sixteen colours a terminal has by default (xterm's), for the 16-colour fallback.
const ANSI16: [(u8, u8, u8); 16] = [
    (0, 0, 0),
    (205, 0, 0),
    (0, 205, 0),
    (205, 205, 0),
    (0, 0, 238),
    (205, 0, 205),
    (0, 205, 205),
    (229, 229, 229),
    (127, 127, 127),
    (255, 0, 0),
    (0, 255, 0),
    (255, 255, 0),
    (92, 92, 255),
    (255, 0, 255),
    (0, 255, 255),
    (255, 255, 255),
];

/// The levels of the 6x6x6 colour cube in the 256-colour palette.
const CUBE: [i32; 6] = [0, 95, 135, 175, 215, 255];

/// How many colours the terminal can show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ColorLevel {
    /// None: no escape codes at all.
    None,
    /// The 16 colours every terminal has.
    Ansi16,
    /// The 256-colour palette.
    Ansi256,
    /// 24-bit colour.
    TrueColor,
}

impl ColorLevel {
    /// `truecolor`, `256`, `16` or `mono` (the names the renderers and the goldens use).
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "truecolor" => Some(Self::TrueColor),
            "256" => Some(Self::Ansi256),
            "16" => Some(Self::Ansi16),
            "mono" => Some(Self::None),
            _ => None,
        }
    }
}

/// What this terminal can show, decided from the environment (the same rules, in the same order, as `install.sh` and
/// `install.ps1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    /// The colour level.
    pub color: ColorLevel,
    /// The locale is UTF-8: block art and the check marks are safe.
    pub unicode: bool,
    /// Standard output is a terminal that can take escape codes and redraw (not dumb, not a pipe).
    pub interactive: bool,
    /// A short animation is allowed: interactive, UTF-8, not CI, `BOOPIS_NO_ANIMATION` unset.
    pub animate: bool,
}

/// Whether a variable is set to something other than empty.
fn set(vars: &dyn Fn(&str) -> Option<String>, name: &str) -> bool {
    vars(name).is_some_and(|v| !v.is_empty())
}

impl Caps {
    /// Decide from the environment (`vars`) and whether standard output is a terminal (`tty`).
    ///
    /// - `NO_COLOR` (non-empty), `TERM=dumb` and a pipe give no colour (<https://no-color.org>).
    /// - `COLORTERM` of `truecolor` or `24bit` gives truecolor, a `TERM` ending in `256color` gives 256, anything else
    ///   on a terminal gives 16. Windows Terminal (`WT_SESSION`) gives truecolor.
    /// - The animation needs an interactive, UTF-8 terminal, no `CI`, and `BOOPIS_NO_ANIMATION` unset, empty or `0`.
    #[must_use]
    pub fn detect(vars: &dyn Fn(&str) -> Option<String>, tty: bool) -> Self {
        let term = vars("TERM").unwrap_or_default();
        let interactive = tty && term != "dumb";
        let color = if set(vars, "NO_COLOR") || !interactive {
            ColorLevel::None
        } else {
            let colorterm = vars("COLORTERM").unwrap_or_default().to_ascii_lowercase();
            if colorterm == "truecolor" || colorterm == "24bit" || set(vars, "WT_SESSION") {
                ColorLevel::TrueColor
            } else if term.ends_with("256color") {
                ColorLevel::Ansi256
            } else {
                ColorLevel::Ansi16
            }
        };
        let locale = ["LC_ALL", "LC_CTYPE", "LANG"]
            .iter()
            .find_map(|k| vars(k).filter(|v| !v.is_empty()))
            .unwrap_or_default()
            .to_ascii_lowercase();
        let unicode =
            locale.contains("utf-8") || locale.contains("utf8") || set(vars, "WT_SESSION");
        let no_animation = vars("BOOPIS_NO_ANIMATION").is_some_and(|v| !v.is_empty() && v != "0");
        Self {
            color,
            unicode,
            interactive,
            animate: interactive && unicode && !set(vars, "CI") && !no_animation,
        }
    }

    /// Detect from the process environment and standard output.
    #[must_use]
    pub fn from_process() -> Self {
        use std::io::IsTerminal as _;
        Self::detect(&|k| std::env::var(k).ok(), std::io::stdout().is_terminal())
    }
}

/// A colour of the palette. `rgb` is `None` for the terminal's own foreground.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Color {
    /// The name sprites refer to.
    pub name: String,
    /// The colour, or the terminal's foreground.
    pub rgb: Option<(u8, u8, u8)>,
    /// Not drawn without colour (the bots' eyes).
    pub hole: bool,
}

/// A pixel grid in one colour (plus the eye colour where it has `o`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sprite {
    /// The colour of its `#` pixels (an index into the palette).
    pub color: usize,
    /// Width in pixels.
    pub width: usize,
    /// Rows: 0 nothing, 1 the sprite's colour, 2 the eye colour.
    pub rows: Vec<Vec<u8>>,
}

/// A place in a scene: a named position that holds one sprite at a time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Slot {
    /// The slot's name.
    pub name: String,
    /// Left edge, in pixels.
    pub x: usize,
    /// Top edge, in pixels.
    pub y: usize,
    /// The sprite it holds when nothing says otherwise.
    pub sprite: String,
}

/// One step of an animation: how long it shows, and what each named slot holds in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Milliseconds.
    pub ms: u32,
    /// Slot, sprite and a vertical offset in pixels (up is negative).
    pub poses: Vec<(String, String, i32)>,
}

/// The parsed art.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Art {
    colors: Vec<Color>,
    sprites: HashMap<String, Sprite>,
    texts: HashMap<String, String>,
    scenes: HashMap<String, Vec<Slot>>,
    anims: HashMap<String, Vec<Frame>>,
}

/// Why the art did not parse.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("boopis.art line {line}: {message}")]
pub struct ArtError {
    /// 1-based.
    pub line: usize,
    /// What is wrong.
    pub message: String,
}

fn bad<T>(line: usize, message: impl Into<String>) -> Result<T, ArtError> {
    Err(ArtError {
        line,
        message: message.into(),
    })
}

fn parse_hex(s: &str) -> Option<(u8, u8, u8)> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(h, 16).ok()?;
    Some((
        u8::try_from(n >> 16).ok()?,
        u8::try_from((n >> 8) & 255).ok()?,
        u8::try_from(n & 255).ok()?,
    ))
}

impl Art {
    /// The shipped art, parsed once.
    ///
    /// # Panics
    /// Never in a build that passed its tests: `the_shipped_art_is_valid` parses it.
    #[must_use]
    pub fn shipped() -> &'static Art {
        static ART_ONCE: OnceLock<Art> = OnceLock::new();
        ART_ONCE.get_or_init(|| {
            // A parse error here is a broken data file, caught by the unit test before it can ship.
            #[allow(clippy::expect_used)]
            Art::parse(ART).expect("packaging/brand/boopis.art is valid")
        })
    }

    /// Parse the art file.
    ///
    /// # Errors
    /// The line and the reason: an unknown keyword, a colour or sprite that is not defined, a grid that is not
    /// rectangular, a sprite that cell by cell holds two colours that are not an eye on a body.
    #[allow(clippy::too_many_lines)] // one pass over the file: a branch per record kind
    pub fn parse(text: &str) -> Result<Self, ArtError> {
        let mut art = Art::default();
        let mut lines = text.lines().enumerate().map(|(i, l)| (i + 1, l));
        let mut seen_format = false;
        while let Some((n, line)) = lines.next() {
            let line = line.trim_end();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let word: Vec<&str> = line.split(' ').collect();
            match word[0] {
                "format" => {
                    if word.get(1) != Some(&"1") {
                        return bad(n, "this reader knows format 1");
                    }
                    seen_format = true;
                }
                "color" => {
                    let (Some(name), Some(value)) = (word.get(1), word.get(2)) else {
                        return bad(n, "color <name> <#rrggbb | -> [hole]");
                    };
                    let rgb = if *value == "-" {
                        None
                    } else {
                        Some(parse_hex(value).ok_or(ArtError {
                            line: n,
                            message: format!("{value} is not #rrggbb"),
                        })?)
                    };
                    art.colors.push(Color {
                        name: (*name).to_owned(),
                        rgb,
                        hole: word.get(3) == Some(&"hole"),
                    });
                }
                "text" => {
                    let Some(name) = word.get(1) else {
                        return bad(n, "text <name> <string>");
                    };
                    let rest = line.splitn(3, ' ').nth(2).unwrap_or_default();
                    art.texts.insert((*name).to_owned(), rest.to_owned());
                }
                "sprite" => {
                    let (Some(name), Some(color)) = (word.get(1), word.get(2)) else {
                        return bad(n, "sprite <name> <color>");
                    };
                    let Some(ci) = art.color_index(color) else {
                        return bad(n, format!("no color named {color}"));
                    };
                    let mut rows: Vec<Vec<u8>> = Vec::new();
                    loop {
                        let Some((m, l)) = lines.next() else {
                            return bad(n, format!("sprite {name} has no end"));
                        };
                        let l = l.trim_end();
                        if l == "end" {
                            break;
                        }
                        let row = l
                            .chars()
                            .map(|c| match c {
                                '.' => Ok(0),
                                '#' => Ok(1),
                                'o' => Ok(2),
                                other => bad(m, format!("{other:?} is not . # or o")),
                            })
                            .collect::<Result<Vec<u8>, _>>()?;
                        rows.push(row);
                    }
                    let width = rows.first().map_or(0, Vec::len);
                    if width == 0 || rows.iter().any(|r| r.len() != width) {
                        return bad(n, format!("sprite {name} is not a rectangle"));
                    }
                    if rows.iter().flatten().any(|p| *p == 2) && art.eye_index().is_none() {
                        return bad(n, "sprite has eyes but there is no hole color");
                    }
                    art.sprites.insert(
                        (*name).to_owned(),
                        Sprite {
                            color: ci,
                            width,
                            rows,
                        },
                    );
                }
                "scene" => {
                    let Some(name) = word.get(1) else {
                        return bad(n, "scene <name>");
                    };
                    let mut slots = Vec::new();
                    loop {
                        let Some((m, l)) = lines.next() else {
                            return bad(n, format!("scene {name} has no end"));
                        };
                        let l: Vec<&str> = l.trim().split(' ').collect();
                        if l == ["end"] {
                            break;
                        }
                        let ok = l.len() == 5 && l[0] == "slot";
                        let (x, y) = (
                            l.get(2).and_then(|v| v.parse::<usize>().ok()),
                            l.get(3).and_then(|v| v.parse::<usize>().ok()),
                        );
                        let (true, Some(x), Some(y)) = (ok, x, y) else {
                            return bad(m, "slot <name> <x> <y> <sprite>");
                        };
                        slots.push(Slot {
                            name: l[1].to_owned(),
                            x,
                            y,
                            sprite: l[4].to_owned(),
                        });
                    }
                    art.scenes.insert((*name).to_owned(), slots);
                }
                "anim" => {
                    let Some(name) = word.get(1) else {
                        return bad(n, "anim <scene>");
                    };
                    let mut frames = Vec::new();
                    loop {
                        let Some((m, l)) = lines.next() else {
                            return bad(n, format!("anim {name} has no end"));
                        };
                        let l: Vec<&str> = l.trim().split(' ').collect();
                        if l == ["end"] {
                            break;
                        }
                        let ms = l.get(1).and_then(|v| v.parse::<u32>().ok());
                        let (true, Some(ms)) = (l.first() == Some(&"frame"), ms) else {
                            return bad(m, "frame <ms> <slot>=<sprite>[@dy] ...");
                        };
                        let mut poses = Vec::new();
                        for p in &l[2..] {
                            let Some((slot, rest)) = p.split_once('=') else {
                                return bad(m, format!("{p} is not slot=sprite"));
                            };
                            let (sprite, dy) = match rest.split_once('@') {
                                Some((s, d)) => {
                                    (s, d.parse::<i32>().or_else(|_| bad(m, "bad @dy"))?)
                                }
                                None => (rest, 0),
                            };
                            poses.push((slot.to_owned(), sprite.to_owned(), dy));
                        }
                        frames.push(Frame { ms, poses });
                    }
                    art.anims.insert((*name).to_owned(), frames);
                }
                other => return bad(n, format!("unknown keyword {other}")),
            }
        }
        if !seen_format {
            return bad(1, "the file does not say `format 1`");
        }
        art.check()?;
        Ok(art)
    }

    fn color_index(&self, name: &str) -> Option<usize> {
        self.colors.iter().position(|c| c.name == name)
    }

    fn eye_index(&self) -> Option<usize> {
        self.colors.iter().position(|c| c.hole)
    }

    /// Everything a scene or an animation names exists, and no cell of any frame holds two colours that are not an
    /// eye on a body (a cell has two colours at most: the renderer could not draw a third).
    fn check(&self) -> Result<(), ArtError> {
        for (scene, slots) in &self.scenes {
            for s in slots {
                if !self.sprites.contains_key(&s.sprite) {
                    return bad(1, format!("scene {scene}: no sprite {}", s.sprite));
                }
            }
            let frames = std::iter::once(None).chain(
                self.anims
                    .get(scene)
                    .into_iter()
                    .flatten()
                    .enumerate()
                    .map(|(i, _)| Some(i)),
            );
            for f in frames {
                let canvas = self.compose(scene, f).ok_or(ArtError {
                    line: 1,
                    message: format!(
                        "scene {scene}: frame {f:?} names a slot or sprite that is not there"
                    ),
                })?;
                if let Some((r, c)) = canvas.first_crowded_cell() {
                    return bad(
                        1,
                        format!(
                            "scene {scene}: frame {f:?}: cell row {r}, column {c} holds two body colours"
                        ),
                    );
                }
            }
        }
        for (name, frames) in &self.anims {
            if !self.scenes.contains_key(name) {
                return bad(1, format!("anim {name}: no scene of that name"));
            }
            if frames.iter().map(|f| u64::from(f.ms)).sum::<u64>() > 1500 {
                return bad(1, format!("anim {name} runs longer than 1.5 s"));
            }
        }
        Ok(())
    }

    /// A text entry: `compact`, `compact.ascii`.
    #[must_use]
    pub fn text(&self, name: &str) -> Option<&str> {
        self.texts.get(name).map(String::as_str)
    }

    /// The names of the scenes, sorted.
    #[must_use]
    pub fn scenes(&self) -> Vec<&str> {
        let mut v: Vec<&str> = self.scenes.keys().map(String::as_str).collect();
        v.sort_unstable();
        v
    }

    /// How many frames the scene's animation has.
    #[must_use]
    pub fn frame_count(&self, scene: &str) -> usize {
        self.anims.get(scene).map_or(0, Vec::len)
    }

    /// The colour called `name`.
    #[must_use]
    pub fn color(&self, name: &str) -> Option<&Color> {
        self.colors.iter().find(|c| c.name == name)
    }

    /// Draw a scene on a pixel canvas: its slots as written (`frame` is `None`) or as animation frame `frame` poses
    /// them. `None` when the scene, a slot or a sprite is not there.
    fn compose(&self, scene: &str, frame: Option<usize>) -> Option<Canvas> {
        let slots = self.scenes.get(scene)?;
        let mut width = 0;
        let mut height = 0;
        for s in slots {
            let sp = self.sprites.get(&s.sprite)?;
            width = width.max(s.x + sp.width);
            height = height.max(s.y + sp.rows.len());
        }
        let mut canvas = Canvas::new(width + width % 2, height + height % 2);
        let poses: &[(String, String, i32)] = match frame {
            Some(i) => &self.anims.get(scene)?.get(i)?.poses,
            None => &[],
        };
        for s in slots {
            let (name, dy) = match poses.iter().find(|(slot, _, _)| *slot == s.name) {
                Some((_, sprite, dy)) => (sprite.as_str(), *dy),
                None => (s.sprite.as_str(), 0),
            };
            let sp = self.sprites.get(name)?;
            canvas.blit(sp, s.x, s.y, dy, self.eye_index());
        }
        Some(canvas)
    }

    /// The scene as lines of text, ready to print (no indent, no trailing blanks). Frame `None` is the scene as
    /// written, `Some(i)` is animation frame `i`.
    ///
    /// # Errors
    /// The scene or the frame does not exist.
    pub fn render(
        &self,
        scene: &str,
        frame: Option<usize>,
        level: ColorLevel,
    ) -> Result<Vec<String>, String> {
        let canvas = self
            .compose(scene, frame)
            .ok_or_else(|| format!("no scene {scene} (frame {frame:?})"))?;
        Ok(canvas.lines(self, level))
    }

    /// The one-line logo: `b●●pis` on a UTF-8 terminal, plain `boopis` on a pipe or a terminal that is not UTF-8 (output
    /// a script may parse stays text).
    #[must_use]
    pub fn compact(&self, caps: &Caps) -> String {
        let name = if caps.unicode && caps.interactive {
            "compact"
        } else {
            "compact.ascii"
        };
        self.text(name).unwrap_or("boopis").to_owned()
    }
}

/// A grid of pixels: 0 is nothing, otherwise a palette index plus one.
struct Canvas {
    width: usize,
    height: usize,
    px: Vec<usize>,
}

impl Canvas {
    fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            px: vec![0; width * height],
        }
    }

    /// Put a sprite at `(x, y + dy)`; what falls outside the canvas is dropped.
    fn blit(&mut self, sp: &Sprite, x: usize, y: usize, dy: i32, eye: Option<usize>) {
        for (r, row) in sp.rows.iter().enumerate() {
            let Some(py) = (i64::try_from(y + r).ok())
                .map(|v| v + i64::from(dy))
                .and_then(|v| usize::try_from(v).ok())
            else {
                continue;
            };
            if py >= self.height {
                continue;
            }
            for (c, p) in row.iter().enumerate() {
                let color = match p {
                    1 => Some(sp.color),
                    2 => eye,
                    _ => None,
                };
                if let Some(color) = color
                    && x + c < self.width
                {
                    self.px[py * self.width + x + c] = color + 1;
                }
            }
        }
    }

    fn at(&self, x: usize, y: usize) -> usize {
        if x < self.width && y < self.height {
            self.px[y * self.width + x]
        } else {
            0
        }
    }

    /// The four pixels of a cell, top left first.
    fn cell(&self, row: usize, col: usize) -> [usize; 4] {
        let (x, y) = (col * 2, row * 2);
        [
            self.at(x, y),
            self.at(x + 1, y),
            self.at(x, y + 1),
            self.at(x + 1, y + 1),
        ]
    }

    fn first_crowded_cell(&self) -> Option<(usize, usize)> {
        // This runs while parsing, before the palette is known to the canvas: two different non-zero values in one
        // cell are fine only when one of them is the eye, which `check` cannot tell here, so it compares by value and
        // lets the renderer's own rule (`split_cell`) decide. A cell is crowded when it holds three values.
        for row in 0..self.height / 2 {
            for col in 0..self.width / 2 {
                let mut vals: Vec<usize> = self
                    .cell(row, col)
                    .into_iter()
                    .filter(|v| *v != 0)
                    .collect();
                vals.sort_unstable();
                vals.dedup();
                if vals.len() > 2 {
                    return Some((row, col));
                }
            }
        }
        None
    }

    fn lines(&self, art: &Art, level: ColorLevel) -> Vec<String> {
        let eye = art.eye_index();
        let mut out = Vec::new();
        for row in 0..self.height / 2 {
            let mut cells: Vec<(char, Option<Paint>, Option<Paint>)> = Vec::new();
            for col in 0..self.width / 2 {
                cells.push(split_cell(art, self.cell(row, col), eye, level));
            }
            while matches!(cells.last(), Some((' ', _, None))) {
                cells.pop();
            }
            out.push(escape_row(&cells, level));
        }
        out
    }
}

/// A colour to draw with: the terminal's foreground is `None` and never appears here.
type Paint = (u8, u8, u8);

/// One cell: the character, the foreground and the background. A cell of an eye on a body is the eye's shape in the
/// eye colour over the body colour (the body fills what the eye does not), and without colour the eye is a hole.
fn split_cell(
    art: &Art,
    px: [usize; 4],
    eye: Option<usize>,
    level: ColorLevel,
) -> (char, Option<Paint>, Option<Paint>) {
    let is_eye = |v: usize| eye.is_some_and(|e| v == e + 1);
    let mut eye_mask = 0usize;
    let mut body_mask = 0usize;
    let mut body = 0usize;
    for (i, v) in px.iter().enumerate() {
        if *v == 0 {
            continue;
        }
        if is_eye(*v) {
            eye_mask |= 1 << i;
        } else {
            body_mask |= 1 << i;
            if body == 0 {
                body = *v;
            }
        }
    }
    let paint = |v: usize| art.colors.get(v.wrapping_sub(1)).and_then(|c| c.rgb);
    if level == ColorLevel::None {
        return (QUADRANTS[body_mask], None, None);
    }
    match (eye_mask, body_mask) {
        (0, m) => (QUADRANTS[m], paint(body), None),
        (m, 0) => (QUADRANTS[m], eye.and_then(|e| paint(e + 1)), None),
        (m, _) => (QUADRANTS[m], eye.and_then(|e| paint(e + 1)), paint(body)),
    }
}

/// The nearest of the xterm 256-colour palette to a colour (the cube or the grey ramp, whichever is closer; the cube on
/// a tie), as an index from 16.
#[must_use]
pub fn nearest_256((red, green, blue): Paint) -> u8 {
    let (red, green, blue) = (i32::from(red), i32::from(green), i32::from(blue));
    // The cube level nearest to a channel value (the lower on a tie).
    let level = |value: i32| {
        let mut best = 0;
        for (i, step) in CUBE.iter().enumerate() {
            if (value - step).abs() < (value - CUBE[best]).abs() {
                best = i;
            }
        }
        best
    };
    let distance =
        |p: (i32, i32, i32)| (red - p.0).pow(2) + (green - p.1).pow(2) + (blue - p.2).pow(2);
    let (ri, gi, bi) = (level(red), level(green), level(blue));
    let cube_distance = distance((CUBE[ri], CUBE[gi], CUBE[bi]));
    let mut grey = (0, i32::MAX);
    for i in 0..24 {
        let shade = 8 + 10 * i;
        let d = distance((shade, shade, shade));
        if d < grey.1 {
            grey = (i, d);
        }
    }
    let index = if cube_distance <= grey.1 {
        16 + 36 * ri + 6 * gi + bi
    } else {
        232 + usize::try_from(grey.0).unwrap_or(0)
    };
    u8::try_from(index).unwrap_or(15)
}

/// The nearest of the 16 default colours, as an index 0 to 15 (the lower on a tie).
#[must_use]
pub fn nearest_16((r, g, b): Paint) -> usize {
    let (r, g, b) = (i32::from(r), i32::from(g), i32::from(b));
    let mut best = 0;
    let mut best_d = i32::MAX;
    for (i, (pr, pg, pb)) in ANSI16.iter().enumerate() {
        let d =
            (r - i32::from(*pr)).pow(2) + (g - i32::from(*pg)).pow(2) + (b - i32::from(*pb)).pow(2);
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
}

/// The SGR parameters that set a colour (`foreground`) or its background, at `level`.
#[must_use]
pub fn sgr(color: Paint, foreground: bool, level: ColorLevel) -> String {
    let plane = if foreground { 38 } else { 48 };
    match level {
        ColorLevel::None => String::new(),
        ColorLevel::TrueColor => format!("{plane};2;{};{};{}", color.0, color.1, color.2),
        ColorLevel::Ansi256 => format!("{plane};5;{}", nearest_256(color)),
        ColorLevel::Ansi16 => {
            let i = nearest_16(color);
            let base = if foreground { 30 } else { 40 };
            if i < 8 {
                format!("{}", base + i)
            } else {
                format!("{}", base + 60 + i - 8)
            }
        }
    }
}

/// One row: set the colours only when they change, reset at the end. A blank cell on a coloured background resets
/// first, so the background does not leak across it.
fn escape_row(cells: &[(char, Option<Paint>, Option<Paint>)], level: ColorLevel) -> String {
    let mut out = String::new();
    let mut state: (Option<Paint>, Option<Paint>) = (None, None);
    for (ch, fg, bg) in cells {
        if level != ColorLevel::None {
            let want = if *ch == ' ' && bg.is_none() {
                (None, None)
            } else {
                (*fg, *bg)
            };
            let blank = *ch == ' ' && bg.is_none();
            // A blank cell shows no foreground, so it only needs a reset when a background is active.
            let need = if blank {
                state.1.is_some()
            } else {
                state != want
            };
            if need {
                let mut codes = String::from("0");
                if let Some(c) = want.0 {
                    let _ = write!(codes, ";{}", sgr(c, true, level));
                }
                if let Some(c) = want.1 {
                    let _ = write!(codes, ";{}", sgr(c, false, level));
                }
                let _ = write!(out, "\u{1b}[{codes}m");
                state = if blank { (None, None) } else { want };
            }
        }
        out.push(*ch);
    }
    if state != (None, None) {
        out.push_str("\u{1b}[0m");
    }
    out
}

/// What the command-line output paints with: the palette's own colours, never a colour of its own.
#[derive(Debug, Clone, Copy)]
pub struct Ink {
    level: ColorLevel,
}

/// A role in command-line text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    /// The terminal's foreground, bold.
    Strong,
    /// Quiet: labels and notes.
    Dim,
    /// Done and well (moss).
    Ok,
    /// Worth a look (terra).
    Warn,
    /// Failed (nina).
    Fail,
}

impl Ink {
    /// Paint at `level`.
    #[must_use]
    pub fn new(level: ColorLevel) -> Self {
        Self { level }
    }

    /// `text` in `tone`, with a reset after it; the text itself when there is no colour.
    #[must_use]
    pub fn paint(&self, tone: Tone, text: &str) -> String {
        if self.level == ColorLevel::None {
            return text.to_owned();
        }
        let accent = |name: &str| {
            Art::shipped()
                .color(name)
                .and_then(|c| c.rgb)
                .map(|c| sgr(c, true, self.level))
        };
        let codes = match tone {
            Tone::Strong => Some("1".to_owned()),
            Tone::Dim => Some("2".to_owned()),
            Tone::Ok => accent("moss"),
            Tone::Warn => accent("terra"),
            Tone::Fail => accent("nina"),
        };
        match codes {
            Some(c) => format!("\u{1b}[{c}m{text}\u{1b}[0m"),
            None => text.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests;
