/* Every beat's key frame builder, by beat id (SC/script/beats.json). B19 is the end card, variant (b) only (the owner's
   decision of 22 November 2026: no address anywhere). B14 and B15 have two: `b14-dock` and `b15-dock` are the product's own
   dock view and what the film must show; `b14` and `b15` are the hand-made first boards, kept only because act 4 still
   takes them apart by their structure. */
import { b01, b02, b03 } from './hook';
import { b04, b05, b06, b07 } from './room';
import { b08, b09, b10, b11 } from './session';
import { b12, b13, b14, b14Dock, b15, b15Dock, b16 } from './desk';
import { b17, b18, b19b } from './close';

type Build = (s: HTMLElement, vertical: boolean) => void | Promise<void>;
export const BEATS: Record<string, Build> = { b01, b02, b03, b04, b05, b06, b07, b08, b09, b10, b11, b12, b13, b14, 'b14-dock': b14Dock, b15, 'b15-dock': b15Dock, b16, b17, b18, b19b };
