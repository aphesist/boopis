/// <reference types="vite/client" />
/* the vendored elements are side-effect scripts; their types are their own .d.ts files (tsconfig "include") */
declare module '*/orb-avatar.min.js';
declare module '*/boopis-logo.js';
declare const __HX_TEST_API__: boolean;
declare module 'flubber' {
  type Shape = string | [number, number][];
  interface Opts { maxSegmentLength?: number; string?: boolean; single?: boolean }
  export function interpolate(from: Shape, to: Shape, o?: Opts): (t: number) => string;
  export function separate(from: Shape, to: Shape[], o?: Opts & { single?: false }): ((t: number) => string)[];
  export function combine(from: Shape[], to: Shape, o?: Opts & { single?: false }): ((t: number) => string)[];
  export function interpolateAll(from: Shape[], to: Shape[], o?: Opts & { single?: false }): ((t: number) => string)[];
  export function toCircle(from: Shape, x: number, y: number, r: number, o?: Opts): (t: number) => string;
  export function toRect(from: Shape, x: number, y: number, w: number, h: number, o?: Opts): (t: number) => string;
  export function fromCircle(x: number, y: number, r: number, to: Shape, o?: Opts): (t: number) => string;
  export function splitPathString(d: string): string[];
}
