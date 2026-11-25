import type { IncomingMessage, ServerResponse } from 'node:http';

export const UI_ROOT: string;
export const V6: string;
export const BOARDS: string;
export function typeOf(file: string): string;
export function googleFontsCss(search: string): string;
export function localFonts(html: string): string;
export function v6IndexPage(): string;
export function labRoute(rawUrl: string | undefined): [number, string, string | Buffer] | null;
export function labMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void;
