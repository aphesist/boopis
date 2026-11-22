/* Every beat's key frame builder, by beat id (SC/script/beats.json); B19 is boarded twice, with and without the address. */
import { b01, b02, b03 } from './hook';
import { b04, b05, b06, b07 } from './room';
import { b08, b09, b10, b11 } from './session';
import { b12, b13, b14, b15, b16 } from './desk';
import { b17, b18, b19a, b19b } from './close';

type Build = (s: HTMLElement, vertical: boolean) => void | Promise<void>;
export const BEATS: Record<string, Build> = { b01, b02, b03, b04, b05, b06, b07, b08, b09, b10, b11, b12, b13, b14, b15, b16, b17, b18, b19a, b19b };
