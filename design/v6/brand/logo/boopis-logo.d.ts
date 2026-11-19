/** The bots' own eye states (the reactions of the vendored <orb-avatar>), as BoopisLogo.states lists them. */
export type BoopisLogoState =
  | 'idle' | 'listening' | 'thinking' | 'compute' | 'working' | 'speaking' | 'happy' | 'done'
  | 'needs' | 'sleeping' | 'error' | 'wink' | 'skeptic' | 'love' | 'sad' | 'dizzy';

/** One of the orb's eye shapes, usable as a state of its own. */
export type BoopisLogoEyeShape =
  | 'pill' | 'tall' | 'circle' | 'wide' | 'squint' | 'square' | 'grid' | 'matrix' | 'bars' | 'stack'
  | 'arc' | 'rest' | 'chevron' | 'slant' | 'plus' | 'diamond' | 'heart';

/** A state name, an eye shape, or a [left, right] pair of eye shapes (as orb.sequence takes). null is idle. */
export type BoopisLogoSpec = BoopisLogoState | BoopisLogoEyeShape | [BoopisLogoEyeShape, BoopisLogoEyeShape] | (string & {}) | null;

export type BoopisLogoStep =
  | BoopisLogoSpec
  | {
      /** A state, an eye shape or a pair. */
      state?: BoopisLogoSpec;
      eyes?: BoopisLogoSpec;
      /** Seconds from the start of this step's morph to the start of the next. Default: stepDuration. */
      hold?: number;
      /** Seconds into the step at which the eyes blink once. */
      blink?: number;
    };

export interface BoopisLogoPlayOptions {
  /** Default hold, seconds. Default 0.9. */
  stepDuration?: number;
  /** Seconds each morph takes. Default 0.38 (the orb's own). */
  morphDuration?: number;
}

export interface BoopisLogoElement extends HTMLElement {
  /** Takes the eyes from the shape drawn now to a state. Never cuts, safe in bursts. Reduced motion: a short crossfade. */
  morph(state?: BoopisLogoSpec, options?: { morphDuration?: number }): this;
  /** on: morph to the state. off: back to idle, only if that state is still the target. */
  follow(state: BoopisLogoSpec, on: boolean): this;
  /** Runs 'hero' or your own steps; resolves when the eyes are idle again. Reduced motion: resolves at once, nothing plays. */
  play(sequence?: 'hero' | BoopisLogoStep[], options?: BoopisLogoPlayOptions): Promise<this>;
  /** Stops a sequence and goes back to idle. */
  stop(): this;
  /** One blink now (the orb's 0.155 s). */
  blink(): this;
  /** Look where x and y say, each -1 (left, down) to 1 (right, up), capped like the bots' gaze. look() lets go. */
  look(x?: number, y?: number): this;
  /** letters="play": one idle fidget now (a letter rocks, or the tittle hops). */
  fidget(): this;
  readonly state: string;
  /** Default "boopis". The first "oo" of the word is the eyes. Other words exist for tests; the logo is boopis. */
  word: string;
  weight: number;
  letters: 'still' | 'play';
}

export interface BoopisLogoStatic {
  states: BoopisLogoState[];
  sequences: Record<string, BoopisLogoStep[]>;
  /** The word of the wordmark: "boopis". */
  word: string;
  /** A static SVG string of the logo in a state (default idle). Default word "boopis"; mark: true for the two eyes alone. color defaults to currentColor. */
  svg(options?: { word?: string; mark?: boolean; state?: BoopisLogoSpec; t?: number; weight?: 500 | 600; color?: string; pad?: number; label?: string }): string;
  /** The wordmark's minimum size, as a type size in px. Below it the element draws the mark. */
  minEm: number;
  /** The playful letters run only from this type size (px). */
  minPlayEm: number;
  /** The protection area, as a fraction of the type size (of the height of the mark's eyes' em box for the mark). */
  protection: number;
  timing: { morph: number; blink: number; fade: number; rest: number };
  Element: { new (): BoopisLogoElement };
}

declare global {
  interface Window { BoopisLogo: BoopisLogoStatic }
  interface HTMLElementTagNameMap { 'boopis-logo': BoopisLogoElement }
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'boopis-logo': {
        /** The wordmark's word. Default "boopis". Its first "oo" is the two eyes. */
        word?: string;
        /** Only the two eyes (the symbol). */
        mark?: boolean | '';
        /** One frame: no blink, no glance, no motion. For headers, lists and documents. Live eyes are the default. */
        still?: boolean | '';
        /** 'off' turns the idle blink off (live eyes blink by default). */
        blink?: 'off';
        /** 'off' turns the glances and the drift off (live eyes glance by default). */
        gaze?: 'off';
        /** The eyes follow the pointer, with a capped gaze. */
        look?: boolean | '';
        /** 'play': every letter is its own piece and moves. Big moments only: a launch, a site hero, the first-run welcome. Default 'still'. */
        letters?: 'still' | 'play';
        /** Initial state. */
        state?: BoopisLogoSpec;
        /** 'hero': play the loop on connect (with `loop`, repeat). */
        animation?: 'hero' | 'none';
        loop?: boolean | '';
        /** Letter weight, 500 or 600 (default 600). */
        weight?: 500 | 600;
        /** Accessible name. Default: "boopis". */
        label?: string;
        class?: string;
        className?: string;
        style?: React.CSSProperties;
        ref?: React.Ref<BoopisLogoElement>;
      };
    }
  }
}
