/* The film, in order. Each scene owns its bars; the grid is 100 BPM, a bar 2.4 s (engine/common.ts). */
import type { SceneDef } from '../engine/stage';
import { open } from './s01-open';
import { team } from './s02-team';
import { rooms } from './s03-rooms';
import { feedforward } from './s04-feedforward';
import { tools } from './s05-tools';
import { governed } from './s06-governed';
import { models } from './s07-models';
import { learn } from './s08-learn';
import { store } from './s09-store';
import { montage } from './s10-montage';
import { finale, T_TOTAL } from './s11-finale';
export const DURATION = T_TOTAL;
export const SCENES: SceneDef[] = [open, team, rooms, feedforward, tools, governed, models, learn, store, montage, finale];
