/* <hx-card>: the card layer of the shared library.
   create(kind, data, opts) -> <hx-card>     el.update(patch)     el.state
   Events (bubble from the card, cancelable): 'hx:card-action' {kind, action, data, state, value, card}
     preventDefault() keeps the card where it is, so the host can drive state with el.update({state}).
   'hx:card-state' {kind, state, prev, data, card} after every state change.
   `hx:attention` {source: 'cards', count} whenever the number of cards waiting on the user changes.
   Sizes: inline (in the measure, up to 520px), compact (dock, side panel, up to 360px), mini (one row);
   blank also has popover (the expanded blank).
   Keys (KEYMAP section 6): hold Space or Enter twice on Hold to approve; x denies while focus is in an approval; d opens
   the diff from a ship card; 1-9 pick a blank option; Esc closes the popover. Every item waiting on the user marks
   its focusable element with data-hx-attention, so F8 / shift+F8 can find it.
   OWNER DECISION: a card that changes state grows or shrinks over --dur-3 on --spring, so the conversation under
   it never jumps (the one height animation; under reduced motion it snaps). */
import { emit } from '../../core/bus';
import { nid, reduced } from '../../core/dom';
import { holdOf, kit, wireHold } from '@boopis/ui';
import { data as provider } from '../../data';
import type { CardKind, CardOpts, CardSize } from '@boopis/ui';
import { bot, expiryText, KINDS, parts } from './kinds';
import { accentOf, originOf } from './parts';
import { fitCard, unwatchFit, watchFit } from './fit';
import { LIVE_FORM, dropSecrets, formKey, newFormState, wireForm } from './form';
import type { FormState } from './form';
import { animate, easeToken, motion } from './motion';
import type { Ctx, Data, Kind } from './types';
import { blankValue, wireBlankOptions } from './options';
import { asV7 } from '../session/s0';

export interface CardActionDetail { kind: CardKind; action: string; data: Data; state: string; value: string | null | undefined; card: HxCard }
export interface CardStateDetail { kind: CardKind; state: string; prev: string; data: Data; card: HxCard }

const LIVE = new Set<HxCard>();
export const QUEUES = new Set<QueueRoot>();
export interface QueueRoot extends HTMLElement { _waiting(): number }
let lastAttn = -1, attnQueued = false;
export function emitAttention(): void {
  if (attnQueued) return;
  attnQueued = true;
  queueMicrotask(() => {
    attnQueued = false;
    let n = 0;
    for (const c of LIVE) if (c.attn()) n++;
    for (const q of QUEUES) if (q.isConnected) n += q._waiting();
    if (n !== lastAttn) { lastAttn = n; emit('hx:attention', { source: 'cards', count: n }); }
  });
}

/* swap one region's content in place: the old content fades out first, then the new one settles in */
function swapRegion(el: HTMLElement, html: string): void {
  if (el.childNodes.length) {
    const g = el.cloneNode(true) as HTMLElement;
    g.removeAttribute('data-r'); g.removeAttribute('id');
    for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
    g.classList.add('cd-ghost'); g.setAttribute('aria-hidden', 'true'); g.inert = true;
    g.style.cssText += ';position:absolute;margin:0;pointer-events:none;left:' + el.offsetLeft + 'px;top:' + el.offsetTop + 'px;width:' + el.offsetWidth + 'px';
    el.parentNode?.appendChild(g);
    const a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 1 : 90, easing: easeToken(), fill: 'forwards' });
    a.onfinish = () => g.remove();
  }
  el.innerHTML = html;
  if (html) animate(el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { preset: 'fade', delay: 70, fill: 'backwards' });
}

export class HxCard extends HTMLElement {
  kind!: CardKind;
  state!: string;
  data!: Data;
  size!: CardSize;
  opts!: CardOpts;
  /** the inline blank a popover was opened from */
  source: HxCard | null = null;
  blankPop: HxCard | null = null;
  /** a form's own state: typed values and secrets, never in the DOM's events */
  formState: FormState | null = null;
  /** set while another card with the same id is copying its state onto this one */
  syncing = false;
  private K!: Kind;
  private cardId = '';
  private sig: Record<string, string> = {};
  /** when the card last changed state (ms) */
  at = 0;
  private inlineOnly = false;
  private live: HTMLElement | null = null;
  private regions: Record<string, HTMLElement> = {};
  private expiresAt = 0;
  private timer = 0;
  private hAnim: Animation | null = null;

  connectedCallback(): void {
    if (!this.kind) return;
    LIVE.add(this);
    /* a form is the kit's block: on a page that is not yet v7 (the store, connectors, first run) its card is a v7 island */
    if (this.kind === 'form' && !this.hasAttribute('data-ui') && !this.parentElement?.closest('[data-ui="v7"]')) asV7(this);
    if (this.kind === 'approval' || this.kind === 'form') { this.tick(); this.timer = this.timer || window.setInterval(() => this.tick(), 1000); }
    if (this.state === 'holding' && typeof this.data.progress === 'number') requestAnimationFrame(() => { const h = this.holdBtn(); const c = holdOf(h); if (c) c.show(this.data.progress ?? 0); });
    watchFit(this);
    emitAttention();
  }
  disconnectedCallback(): void {
    LIVE.delete(this);
    unwatchFit(this);
    clearInterval(this.timer); this.timer = 0;
    const h = this.holdBtn(); const c = holdOf(h);
    if (h && c && h.dataset['state'] !== 'done') c.reset();
    emitAttention();
  }

  init(kind: CardKind, d: Data, opts: CardOpts): void {
    /* the modules' own shapes: bots pass {bot: id}; the dock's waits carry {bot, lines, cost} */
    if (!d.from && d.bot && bot(d.bot)) d.from = d.bot;
    if (!d.item && Array.isArray(d.lines)) d.item = d.lines;
    if (d.cost && kind === 'approval') { d.meta = parts(d.meta).concat(parts(d.cost)).join(' · '); delete d.cost; }
    if (kind === 'ship' && !Array.isArray(d.files)) {
      /* a count only: use the session's change list when it matches */
      const ch = provider().details.changes.get();
      d.files = ch.length && (d.files == null || +d.files === ch.length) ? ch.map((x) => [x[0], x[1], x[2]] as const) : [];
    }
    this.kind = kind; this.data = d; this.opts = opts; this.K = KINDS[kind];
    if (kind === 'form') { this.formState = newFormState(); if (!d.id) d.id = nid('form-'); }
    this.size = opts.size ?? 'inline';
    if (kind !== 'blank' && this.size === 'popover') this.size = 'compact';
    this.cardId = nid('cd'); this.sig = {};
    this.state = opts.state ?? d.state ?? (kind === 'form' && d.resolved ? ({ submitted: 'done', cancelled: 'cancelled', expired: 'expired' } as const)[d.resolved] : this.K.initial);
    delete d.state;
    if (!this.K.states.includes(this.state)) this.state = this.K.initial;
    this.at = d.decidedAt || Date.now();
    this.dataset['kind'] = kind; this.dataset['size'] = this.size;
    if (opts.ground) this.dataset['ground'] = opts.ground;
    this.inlineOnly = this.size === 'inline' && !!this.K.inline;
    if (this.size === 'mini') this.innerHTML = '<div data-r="row"></div>';
    else if (this.inlineOnly) this.innerHTML = kind === 'blank' ? '<span data-r="row"></span>' : '<div data-r="row"></div>';
    /* a form is the kit's AskCard block, drawn whole (form.ts): it names itself (a group labelled by its ask) */
    else if (kind === 'form') this.innerHTML = '<div data-r="whole"></div>';
    else {
      this.innerHTML = '<div class="cd-side" data-r="side"></div><div class="cd-main"><div data-r="head"></div><div data-r="body"></div><div data-r="foot"></div></div>';
      if (this.size === 'popover') { this.setAttribute('role', 'dialog'); this.setAttribute('aria-modal', 'true'); }
      else this.setAttribute('role', 'article');
      this.setAttribute('aria-labelledby', this.cardId + '-t');
    }
    const live = document.createElement('span');
    live.className = 'ui-sr'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
    this.append(live); this.live = live;
    this.regions = {};
    for (const r of this.querySelectorAll<HTMLElement>('[data-r]')) this.regions[r.dataset['r'] ?? ''] = r;
    if (kind === 'approval' || kind === 'form') this.armExpiry(false);
    this.addEventListener('click', (e) => this.onClick(e));
    this.addEventListener('keydown', (e) => this.onKey(e));
    this.renderCard(false);
    if (opts.enter) animate(this, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { preset: 'settle' });
  }

  private ctx(): Ctx {
    const K = this.K;
    const c: Ctx = { d: this.data, s: this.state, size: this.size, id: this.cardId, at: clock(this.at), q: this.opts.queue, card: this, plain: '', tone: 'none', owe: '', origin: null };
    c.origin = originOf(this.data) ?? (K.origin ? K.origin(c) : null);
    try { c.plain = K.text ? String(K.text(c)).replace(/`/g, '') : ''; } catch { c.plain = ''; }
    c.tone = K.tone(c) || 'none';
    /* what the card owes the user, in the stamp's words; nothing inside the popover (its question sits right above) */
    c.owe = c.tone === 'red' && this.size !== 'popover' ? (K.stamp ? K.stamp(c) : 'needs you') : '';
    return c;
  }
  plainText(): string { return this.ctx().plain; }

  update(patch: Record<string, unknown>): this {
    const p = { ...(patch ?? {}) } as Record<string, unknown>;
    const next = p['state'] as string | undefined;
    delete p['state'];
    Object.assign(this.data, p);
    if (next && next !== this.state && this.K.states.includes(next)) return this.setState(next);
    this.renderCard(true);
    return this;
  }

  setState(next: string): this {
    const prev = this.state;
    if (prev === next) return this;
    this.state = next;
    const quiet = this.K.quiet?.[prev + '>' + next];
    if (!quiet) {
      this.at = Date.now();
      if ((this.kind === 'approval' && (next === 'pending' || next === 'holding')) || (this.kind === 'form' && next === 'open')) {
        if (this.expiresAt && this.expiresAt <= Date.now() + 1000) this.expiresAt = 0;
        this.armExpiry(false);
      }
      this.renderCard(true);
      if (this.K.say) this.announce(this.K.say(this.ctx()));
    } else this.dataset['state'] = next;
    this.dispatchEvent(new CustomEvent<CardStateDetail>('hx:card-state', { bubbles: true, composed: true, detail: { kind: this.kind, state: next, prev, data: this.data, card: this } }));
    emitAttention();
    if (!this.syncing && this.kind === 'form' && !quiet) syncSiblings(this, next);
    return this;
  }

  announce(text: string): void {
    const live = this.live;
    if (!text || !live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);
  }

  attn(): boolean {
    /* a popover is a preview, and a mirror is the same ask drawn a second time in another place (the dock's session beside its
       needs-you page), so neither waits on the user a second time */
    if (this.size === 'popover' || this.hasAttribute('data-mirror')) return false;
    const c = { d: this.data, s: this.state, size: this.size };
    if (this.K.attention) return this.K.attention(c);
    return this.K.tone(c) === 'red';
  }

  private renderCard(anim: boolean): void {
    const K = this.K, c = this.ctx();
    const out: Record<string, string> = this.size === 'mini' ? { row: K.mini(c) } : this.inlineOnly ? { row: (K.inline as (c: Ctx) => string).call(K, c) } : { ...K.render.call(K, c) };
    const motionOn = anim && this.isConnected;
    const h0 = motionOn ? this.getBoundingClientRect().height : 0;
    let changed = false;
    const focusIn = this.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const focusKey = focusIn && (focusIn.dataset['action'] || (focusIn.hasAttribute('data-hold') ? 'hold' : focusIn.dataset['opt'] != null ? 'opt' + focusIn.dataset['opt'] : focusIn.tagName));
    for (const name in this.regions) {
      const el = this.regions[name] as HTMLElement, html = out[name] ?? '';
      if (this.sig[name] === html) continue;
      changed = true;
      if (motionOn && this.sig[name] && el.offsetParent) swapRegion(el, html); else el.innerHTML = html;
      this.sig[name] = html;
    }
    if (this.regions['side']) this.toggleAttribute('data-side', !!out['side']);
    this.applyState(c, motionOn);
    this.hydrateCard();
    if (focusIn && !this.contains(focusIn)) this.restoreFocus(focusKey || '');
    if (motionOn && changed && this.size !== 'mini' && !(this.inlineOnly && this.kind === 'blank')) this.flipHeight(h0);
    if (changed && this.isConnected) fitCard(this);
  }

  private restoreFocus(key: string): void {
    /* never a button inside a fading ghost: those are inert copies of what just left */
    const live = (sel: string): HTMLElement | null => Array.from(this.querySelectorAll<HTMLElement & { disabled?: boolean }>(sel)).find((x) => !x.closest('.cd-ghost') && !x.disabled) ?? null;
    let t: HTMLElement | null = null;
    if (key === 'hold') t = live('[data-hold]');
    else if (key.indexOf('opt') === 0) t = live('[data-opt="' + key.slice(3) + '"]');
    else if (key) t = live('[data-action="' + key + '"]');
    t = t || live('.cd-foot button') || live('.k7-ask__answers .k7-chip') || live('.cd-mini, .cd-blank') || live('button');
    if (t) t.focus({ preventScroll: true });
    else { this.tabIndex = -1; this.focus({ preventScroll: true }); }
  }

  private applyState(c: Ctx, motionOn: boolean): void {
    const K = this.K;
    this.dataset['state'] = this.state;
    /* the origin's accent: one teammate's colour as a ring and a tint (data, not a literal) */
    const acc = accentOf(c.origin);
    if (acc) { this.style.setProperty('--cd-accent', acc); this.dataset['accent'] = ''; } else { this.style.removeProperty('--cd-accent'); delete this.dataset['accent']; }
    const tone = c.tone, owe = c.owe;
    const prevTone = this.dataset['tone'];
    this.dataset['tone'] = tone;
    /* the stamp in the card's corner (one-line rows carry the dot and the same words, from the template) */
    for (const s of this.querySelectorAll<HTMLElement>('[data-stamp]')) {
      if (s.closest('.cd-ghost')) continue;
      if (s.textContent !== owe) {
        s.textContent = owe;
        if (motionOn && owe && prevTone !== tone) animate(s, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { preset: 'quick' });
      }
    }
    /* KEYMAP section 3: the focusable element of an item that waits on the user carries data-hx-attention (F8 finds it) */
    for (const a of this.querySelectorAll('[data-hx-attention]')) a.removeAttribute('data-hx-attention');
    if (owe || (this.kind === 'blank' && this.state === 'open' && this.size !== 'popover')) {
      const live = (sel: string): HTMLElement | undefined => Array.from(this.querySelectorAll<HTMLElement & { disabled?: boolean }>(sel)).find((x) => !x.closest('.cd-ghost') && !x.disabled);
      const t = (this.kind === 'form' ? live('.k7-ask__fields input:not([type=file]), .k7-ask__fields textarea, .k7-ask__fields [role=radio][tabindex="0"], .k7-ask__fields [role=checkbox], .k7-ask__fields .k7-sel, .k7-ask__choice, [data-action="signin"]') : undefined) || live('[data-hold]') || live('.cd-blank') || live('.cd-mini') || live('.ui-btn--primary') || live('.cd-foot button, .cd-rule button');
      if (t) t.setAttribute('data-hx-attention', '');
    }
    this.toggleAttribute('data-resolved', !!(K.resolved && K.resolved(c)));
    /* aria-busy needs a value: a bare attribute reads as false */
    if (tone === 'pulse') this.setAttribute('aria-busy', 'true'); else this.removeAttribute('aria-busy');
    if (K.orb) {
      const r = K.orb(c);
      for (const o of this.querySelectorAll('orb-avatar')) if (o.getAttribute('reaction') !== r) o.setAttribute('reaction', r);
    }
  }

  holdButton(): HTMLButtonElement | null { return this.holdBtn(); }
  private holdBtn(): HTMLButtonElement | null { return Array.from(this.querySelectorAll<HTMLButtonElement>('[data-hold]')).find((x) => !x.closest('.cd-ghost')) ?? null; }

  private hydrateCard(): void {
    const hold = this.holdBtn();
    if (hold && !hold.dataset['cdWired'] && this.kind === 'form') {
      /* a form's hold is the kit's (an AskCard's hold chip: kit wire.ts wireHold, wired with the block); holding is a card state too */
      hold.dataset['cdWired'] = '1';
      if (!hold.closest('[data-kit~="AskCard"]')) kit.wireHold(hold);
      hold.addEventListener('ui:commit', (e) => { if (!this.act('approve')) e.preventDefault(); });
      new MutationObserver(() => {
        if (hold.hasAttribute('data-holding') && (this.state === 'open' || this.state === 'invalid')) this.setState('holding');
        else if (!hold.hasAttribute('data-holding') && this.state === 'holding') this.setState('open');
      }).observe(hold, { attributes: true, attributeFilter: ['data-holding'] });
    }
    if (hold && !hold.dataset['cdWired']) {
      hold.dataset['cdWired'] = '1';
      wireHold(hold, { announce: (t) => this.announce(t) });
      /* the library's commit is the card's approve; a host that cancels the action leaves the button armed */
      hold.addEventListener('ui:commit', (e) => {
        if (this.kind === 'form') { if (!this.act('approve')) e.preventDefault(); return; }
        if (!this.act('approve')) e.preventDefault();
      });
      /* holding is a card state too: follow the button's data-state */
      new MutationObserver(() => {
        const st = hold.dataset['state'];
        if (st === 'holding' && (this.state === 'pending' || this.state === 'open' || this.state === 'invalid')) this.setState('holding');
        else if (st === 'idle' && this.state === 'holding') this.setState(this.kind === 'form' ? 'open' : 'pending');
      }).observe(hold, { attributes: true, attributeFilter: ['data-state'] });
    }
    if (hold && this.state === 'holding' && typeof this.data.progress === 'number' && this.isConnected) holdOf(hold)?.show(this.data.progress);
    if (this.kind === 'blank' && (this.size === 'popover' || this.size === 'compact')) wireBlankOptions(this);
    if (this.kind === 'form') wireForm(this);
    this.tick();
  }

  private flipHeight(h0: number): void {
    const h1 = this.getBoundingClientRect().height;
    if (Math.abs(h1 - h0) < 1 || reduced()) return;
    if (this.hAnim) this.hAnim.cancel();
    const m = motion('settle');
    this.style.overflow = 'clip';
    const a = this.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], m);
    this.hAnim = a;
    const done = (): void => { if (this.hAnim === a) { this.style.overflow = ''; this.hAnim = null; } };
    a.onfinish = done; a.oncancel = done;
  }

  private armExpiry(force: boolean): void {
    if (this.expiresAt && !force) return;
    const d = this.data;
    if (d.expiresAt) { this.expiresAt = +d.expiresAt; return; }
    const m = /expires in (\d+(?:\.\d+)?)\s*(min|s)/i.exec(parts(d.meta).concat(parts(d.expires)).join(' '));
    if (m) this.expiresAt = Date.now() + (+(m[1] ?? 0)) * (m[2] === 'min' ? 60000 : 1000);
  }
  rearmExpiry(): void { this.expiresAt = 0; this.armExpiry(true); }

  private tick(): void {
    if ((this.kind !== 'approval' && this.kind !== 'form') || !this.expiresAt) return;
    const live = this.kind === 'form' ? LIVE_FORM.includes(this.state) : this.state === 'pending' || this.state === 'holding';
    if (!live) return;
    const left = this.expiresAt - Date.now();
    for (const s of this.querySelectorAll<HTMLElement>('[data-countdown]')) {
      const t = expiryText(left, s.dataset['countdown'] === 'short');
      if (s.textContent !== t) s.textContent = t;
    }
    if (left <= 0 && this.isConnected) { holdOf(this.holdBtn())?.reset(); if (this.kind === 'form') dropSecrets(this); this.setState('expired'); }
  }

  private onClick(e: MouseEvent): void {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-action]');
    if (!b || b.closest('hx-card') !== this || b.disabled) return;
    let value: string | null | undefined;
    const action = b.dataset['action'] ?? '';
    if (action === 'answer') value = blankValue(this);
    /* a form's own buttons run the form (its submit sends one event with the answer, not two) */
    if (this.kind === 'form' && ['submit', 'signin', 'scope', 'change'].includes(action)) { this.K.act?.(this, action, { el: b, value: b.dataset['value'] }); return; }
    this.act(b.dataset['action'] ?? '', { value, el: b });
  }

  /* KEYMAP section 6: x denies while focus is in an approval; d opens the diff from a ship card (never while typing) */
  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (this.kind === 'form' && this.size !== 'mini' && LIVE_FORM.includes(this.state) && formKey(this, e)) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const live = this.state === 'pending' || this.state === 'holding';
    if (e.code === 'KeyX' && this.kind === 'approval' && live && this.size !== 'mini') {
      e.preventDefault();
      holdOf(this.holdBtn())?.reset();
      this.act('deny');
    } else if (e.code === 'KeyD' && this.kind === 'ship' && this.querySelector('[data-action="view-diff"]')) {
      e.preventDefault();
      this.act('view-diff');
    }
  }

  act(action: string, x: { value?: string | null | undefined; el?: HTMLElement | undefined } = {}): boolean {
    const detail: CardActionDetail = { kind: this.kind, action, data: this.data, state: this.state, value: x.value, card: this };
    const ok = this.dispatchEvent(new CustomEvent<CardActionDetail>('hx:card-action', { bubbles: true, composed: true, cancelable: true, detail }));
    if (ok && this.K.act) this.K.act(this, action, x);
    return ok;
  }
}
/* one id, one answer: every card with the same id (the conversation, the dock, the first-run view) takes the state the user
   gave in any one of them, with the same receipt. Typed values of secret fields never travel: only the receipt does. */
const SHARED = ['receiptText', 'cancelledText', 'answered'] as const;
function syncSiblings(src: HxCard, state: string): void {
  for (const c of LIVE) {
    if (c === src || c.kind !== src.kind || c.data.id !== src.data.id || c.state === state) continue;
    /* what the user decided travels; typing and holding stay where they happen. A failed send reopens the card that was sending */
    if (!['submitting', 'done', 'cancelled', 'expired'].includes(state) && !(state === 'open' && c.state === 'submitting')) continue;
    c.syncing = true;
    for (const k of SHARED) if (src.data[k] !== undefined) (c.data as Record<string, unknown>)[k] = src.data[k];
    if (c.formState && src.formState) c.formState.vals = { ...src.formState.vals };
    c.at = src.at;
    try { c.setState(state); } finally { c.syncing = false; }
  }
}
const clock = (t: number): string => { const d = new Date(t || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
if (!customElements.get('hx-card')) customElements.define('hx-card', HxCard);

export function create(kind: CardKind, data: Data, opts: CardOpts = {}): HxCard {
  if (!KINDS[kind]) throw new Error('hx cards: unknown kind "' + kind + '"');
  const el = document.createElement('hx-card') as HxCard;
  el.init(kind, { ...(data ?? {}) }, opts);
  return el;
}
declare global { interface HTMLElementTagNameMap { 'hx-card': HxCard } interface HTMLElementEventMap { 'hx:card-action': CustomEvent<CardActionDetail>; 'hx:card-state': CustomEvent<CardStateDetail> } }
