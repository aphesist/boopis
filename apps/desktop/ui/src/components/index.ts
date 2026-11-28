/* @boopis/ui: the v7 kit (`kit`, `kit.html`: every component once, components/v7/) and the engines it draws with, each a named export:
   the orbs and a bot's look, the model marks, the markdown of what a bot or an agent wrote, the floating layer and its placement, the
   tooltip, the card host, the corners, the scroll areas, the glyphs. The v6 library (`ui`, `html`) went at the repass's step 2b: its
   looks are the kit's, and what it held that is not a look is here by name (docs/design/v7/V6-LEFT.md says what went and what was kept). */
import { frag } from '../core/dom';
import { isRoute, lastModel, modelFamily, modelHTML, modelMark as modelMarkEl, parseRoute, routeHTML, swapMark, families as modelFamilies } from './model-mark';
import { shortName, aliasOf, canon, modelName, providerName, sameModel, splitRef } from './model-name';
import { addressesYou, codeHTML, inlineHTML, plainHTML, markdownHTML, mentionHandles, mentionsOutside, mentionSpans, mentionTarget, pathCandidate, pathCandidates, pathHTML, resolveMentions, splitBlocks, upgradePaths } from './markdown';
import { arrive, codeOf, markdown as markdownEl, streamMarkdown, wireMarkdown } from './md-view';
import { stack } from './stack';
import type { StackOpts } from './stack';
import type { ModelOpts, ModelRef } from './model-mark';

/* the v7 kit (DESIGN-SYSTEM.md v7 section 21), on a v7 root */
export { kit, kitVariants, MOD_MARK, parseLiteral, setTokenReader } from './v7';
export type * from './v7';

/* glyphs, words for assistive tech, copying, escaping */
export { icon, iconNames } from './icons';
export { announce } from './announce';
export { copyText } from './clipboard';
export { esc } from '../core/dom';

/* the orbs: a bot's face, its state map, its look; the runtime the dock, the rooms and the rail wire */
export { orb, orbHtml, liven, glance, oc, startGlance, paintLook, repaintLook, restReact } from './orb';
export type { OrbOpts } from './orb';
export { botLabel, botState, STATES } from './bot-state';
export type { BotLike } from './bot-state';
export { lookOf, lookFor, lookAttrs, drawnColour, sameLook, shapeOf, colourOf, colourName, rollLook, SWATCHES, SHAPES, DRAFT_COLOR } from './look';
export type { Look, LookSource, RollOpts } from './look';
export { shape } from './shape';
export { stack, clusterLayout, namesList, stackSplit } from './stack';
export type { ClusterPlace, StackOpts } from './stack';
/** the avatar stack as an element (the lab's specimens) */
export const stackOf = (o: StackOpts): HTMLElement => frag(stack(o));
export { holdOutsideDock, releaseOutsideDock } from './orb-runtime';
export { orbState, setupOrbs } from './orb-worker/host';
export { FACE_SCALE_MAX, REST_REACTION } from './orb-pose';

/* a model's mark and name: `modelMark(ref, opts)` draws the mark; its properties read the family and the name from a model id */
export const modelMark = Object.assign(modelMarkEl, { called: modelName, short: shortName, provider: providerName, same: sameModel, split: splitRef, canon, aliasOf, family: modelFamily, parse: parseRoute, last: lastModel, isRoute, swap: swapMark, families: modelFamilies });
export { markHTML, modelHTML, routeHTML, isKnownModel } from './model-mark';
export type { ModelRef, ModelOpts, MarkOpts, ModelFamily } from './model-mark';
/** a model's mark and name as an element, and a route of them (the lab's specimens) */
export const modelEl = (ref: ModelRef, o?: ModelOpts): HTMLElement => frag(modelHTML(ref, o));
export const routeEl = (text: string, o?: ModelOpts): HTMLElement => frag(routeHTML(text, o));

/* what a bot or an agent wrote: `markdown(text, ctx)` draws it; its properties are the parts the surfaces use */
export const markdown = Object.assign(markdownEl, {
  html: markdownHTML, inline: inlineHTML, plain: plainHTML, code: codeHTML, blocks: splitBlocks, stream: streamMarkdown, arrive, wire: wireMarkdown, codeOf,
  outsiders: mentionsOutside, handles: mentionHandles, resolve: resolveMentions, target: mentionTarget, spans: mentionSpans, toYou: addressesYou,
  path: pathHTML, pathCandidate, candidates: pathCandidates, upgradePaths
});
export { inlineCodeHTML, pathCandidates, upgradePaths, EVERYONE_HANDLES, HUMAN_HANDLE, MENTION_SOURCE } from './markdown';
export type { MarkdownCtx, MdBot, PathTarget, Block as MarkdownBlock, MentionSpan, MentionTarget } from './markdown';

/* the floating layer (one open at a time, placed by place.ts), the tooltip that names a control, the corners, the scroll areas */
export { layer, popover } from './layer';
export { tooltip } from './tooltip';
export { squircle } from './squircle';
export { scrollClass, SCROLL_AXES } from './scroll';
export type { ScrollAxis, ScrollOpts } from './scroll';
export { scrollEdges } from './scroll-edges';

/* the card host (`hx-card`): a form drawn with the kit, wherever a card goes */
export { card, setCardFactory } from './card-registry';
export type { CardFactory, CardSize, CardKind, CardOpts, CardLike, CardData } from './card-registry';

/* the labs' marks on their sign-in (ADR-0040) and the Store's and Connectors' item marks (conflict 30) */
export { SIGNIN_BRANDS, signinButton, signinLabel, signinLogo, signinMark } from './signin-marks';
export type { SigninBrand, SigninButtonOpts } from './signin-marks';
export { serviceMarkOf, publisherMarkOf, monogram, serviceMarks, serviceMark, packageOf, tileMarkOf, brandMarkHTML, itemTile, connectorKey } from './item-mark';
export type { ItemRef, ServiceMark } from './item-mark';
export type { SelectEntry, SelectGroup, SelectOption, MenuEntry, MenuItem } from './select-entries';
