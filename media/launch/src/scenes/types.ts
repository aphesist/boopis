import type { Film, FilmConfig } from '../engine/film';
import type { Stage } from '../engine/stage';

/** a film (or one part of it): its config and a build function that lays out the stage and writes the timeline */
export interface Scene {
  config: FilmConfig;
  build(film: Film, stage: Stage): void | Promise<void>;
}
