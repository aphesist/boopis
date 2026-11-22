/* Act 1: B01 to B04, 0.000 to 9.600 s (bars 1.1 to 5.3). The hook, the plans you already pay for, the cast, the room.
   Outgoing seam S1 at 9.600 s: the room "release" in B04's key-frame composition, camera at rest (SEAMS.md).

   One chain of hand-offs, nothing faded: the camera falls into kai's eye and the eye is the window onto B02 (a1/b01.ts);
   the sign-in buttons fan out of it (a1/b02.ts); each button's shell becomes a cast card, its lab's mark rides into the
   card's plan line and the orb is uncovered asleep (a1/b03.ts); the cards collapse into their orbs, the orbs fly into
   the room's head stack, and the room opens around them (a1/b04.ts). The beats share their key frames and orbs
   through a1/state.ts; a1/util.ts and a1/orbs.ts are the act's own helpers. Each builder writes at ctx.win() times, so
   the cut-downs play it compressed. */
import type { Act } from './act';
import { a1state } from './a1/state';
import { b01 } from './a1/b01';
import { b02 } from './a1/b02';
import { b03 } from './a1/b03';
import { b04 } from './a1/b04';

export const act: Act = {
  id: 'A1',
  beats: { B01: b01, B02: b02, B03: b03, B04: b04 },
  async seamOut(ctx) {
    /* S1: the room A2 starts from. Its parts are the key frame's own, at rest on 9.600; the orbs are the room's film
       orbs: the head's stack by name, and kai's in your request and in the presence entry */
    if (!ctx.has('B04') || ctx.carry.room) return;
    const s = await a1state(ctx);
    const kf = s.kf.b04;
    if (!kf) return;
    const places = [...kf.querySelectorAll<HTMLElement>(':scope > .ui-place')];
    ctx.carry.room = {
      group: kf,
      ...(places[0] ? { head: places[0] } : {}),
      ...(places[1] ? { thread: places[1] } : {}),
      ...(kf.querySelector<HTMLElement>('.ui-presence') ? { presence: kf.querySelector<HTMLElement>('.ui-presence')! } : {}),
      ...(places[2] ? { composer: places[2] } : {})
    };
    const orbs = s.orbs.b04!, out = new Map(ctx.carry.orbs ?? []);
    const presence = kf.querySelector('.ui-presence'), request = kf.querySelector('.ui-request');
    for (const o of orbs.values()) {
      if (presence?.contains(o.holder)) out.set(o.name + ':presence', o);
      else if (request?.contains(o.holder)) out.set(o.name + ':request', o);
      else out.set(o.name, o);
    }
    ctx.carry.orbs = out;
  }
};
