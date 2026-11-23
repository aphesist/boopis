/* The motion library: everything a scene animator needs, in one import.
     import { grid, arrive, travel, snap, depart, camera, carry, morph, rise, cursor, ... } from '../motion' */
export * from './ease';
export * from './spring';
export * from './time';
export * from './camera';
export * from './carry';
export * from './morph';
export * from './reveal';
export * from './type';
export * from './cursor';
export * from './orb-moves';
export * from './character';
export * from './fade';
/* the script's timeline (beats.json): beat('B03'), at('5.3'), span('2.2-3.2.5'), script.check() */
export * as script from './beats';
export { beat, at, span, beatsIn, BEATS, FILM_DURATION } from './beats';
