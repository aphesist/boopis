# Service marks

The logos the Store, Settings > Connectors and the session's Connectors section draw on an item's tile: the mark of the
service a connector connects to, the mark of a skill's, plugin's or mod's publisher when its source proved the publisher,
and a publisher's mark beside the publisher's name. They are drawn in their brand's colours (the owner's decision of
23 November 2026, recorded in ADR-0040; the model marks and the rest of the app are unchanged).

## What is here

- `svg/*.svg`: the icon files, copied unchanged from the source below (one path each, a 24-unit viewBox, a `<title>`).
  The component reads the path and draws it in `currentColor`; the file itself is never edited.
- `map.json`: which item gets which mark, and why (`rule`). It names the evidence a match needs (an id in boopis's
  collection, an address's host, a package or image, a home page's host, a publisher's exact name that the item's
  source proved) and nothing else. An item with no match gets a monogram, never a look-alike. Each mark's `color` holds
  the colour drawn on the light presets' tile (`light`) and on the dark presets' (`dark`), and why (`color_rule`).

## Source and licence

simple-icons 16.38.1, https://github.com/simple-icons/simple-icons, fetched with `npm pack simple-icons@16.38.1` into a
scratch directory on 22 November 2026; only the files listed below were copied, never the package.

The Simple Icons project and its icon data are released under **CC0 1.0 Universal** (public domain dedication). Its
data file gives no other licence for any of the icons below (the project lists one per icon where an icon has one).

The marks are trademarks of their owners. boopis uses them only to identify the service or publisher an item names,
never to imply endorsement. Simple Icons asks its users to read each brand's guidelines; they are linked below where the
brand publishes them.

| File | Brand | Simple Icons' source | Brand guidelines | Used for |
|---|---|---|---|---|
| `github.svg` | GitHub | https://github.com/logos | https://github.com/logos | the GitHub connector; publisher GitHub |
| `notion.svg` | Notion | https://www.notion.so | none listed | the Notion connector; publisher Notion |
| `supabase.svg` | Supabase | https://github.com/supabase/supabase (packages/common/assets/images) | none listed | the Supabase connector; publisher Supabase |
| `brave.svg` | Brave | https://brave.com/brave-branding-assets | https://brave.com/brave-branding-assets | the Brave Search connector; publisher Brave |
| `atlassian.svg` | Atlassian | https://atlassian.design/resources/logo-library | https://atlassian.design/foundations/logos | the Atlassian (Jira and Confluence) connector; publisher Atlassian |
| `mongodb.svg` | MongoDB | https://www.mongodb.com/pressroom | none listed | the MongoDB connector; publisher MongoDB |
| `sentry.svg` | Sentry | https://sentry.io/branding/ | none listed | the Sentry connector; publisher Sentry |
| `neon.svg` | Neon | https://neon.com/brand | https://neon.com/brand | the Neon connector; publisher Neon |
| `googlechrome.svg` | Google Chrome | https://www.google.com/chrome | https://partnermarketinghub.withgoogle.com/brands/chrome | the Chrome DevTools connector (Chrome's own) |
| `google.svg` | Google | https://partnermarketinghub.withgoogle.com | https://about.google/brand-resource-center/brand-elements/ | publisher Google |
| `anthropic.svg` | Anthropic | https://www.anthropic.com | none listed | publisher Anthropic |
| `vercel.svg` | Vercel | https://vercel.com/geist/brands | https://vercel.com/geist/brands | publisher Vercel |
| `upstash.svg` | Upstash | https://upstash.com | none listed | publisher Upstash (Context7 itself has no mark here) |
| `modelcontextprotocol.svg` | Model Context Protocol | https://github.com/modelcontextprotocol/docs (logo/light.svg) | none listed | publisher Model Context Protocol (the reference servers) |

Not found in the source, so drawn as monograms: Context7, Playwright (and Microsoft), Firecrawl, Exa, Sequential
Thinking and Memory (a connector's tile is its service, never its publisher; the reference servers have the publisher's
mark beside their publisher's name on their page).

**To check before release** (as ADR-0040 does for the sign-in marks): Anthropic's trademark guidelines ask for prior
permission for other uses of its marks; GitHub allows its logo to indicate an integration. Remove a file and its
`map.json` entry if a brand objects; its items fall back to monograms.

## Colours

Each brand's official colour is Simple Icons' `hex` for the icon (its data file, version above). The tile is the kit's
raised tile, `--bg-3`: `#fffdf8` in Bone, `#23211e` in Card catalog, `#1f1f1f` in Graphite and Typewriter. A mark must
hold 3:1 against it (WCAG 1.4.11, the system's floor for marks). Where the brand colour does, it is drawn as it is; where
it does not, the brand's one-colour version is drawn instead, black on the light tile or white on the dark ones, which
every brand below allows (GitHub, Vercel and Notion publish black and white logos only; Atlassian and Sentry give a white
logo for dark backgrounds; the rest publish no rule against a one-colour version in Simple Icons' data, and their pages,
linked above, should be read again before release). No hue is shifted and no file is recoloured: the colour is applied to
the unchanged path. Google's G and Chrome's logo are four colours officially; Simple Icons carries one path, drawn in
Google blue. The test is `components/item-mark.test.ts` ("every mark holds 3:1 against the tile of every preset").

| Mark | Simple Icons `hex` | On the light tile (Bone) | On the dark tiles (Card catalog, Graphite, Typewriter) | Why |
|---|---|---|---|---|
| GitHub | `#181717` | `#181717` | `#FFFFFF` | GitHub publishes its logo in black or white only (github.com/logos): black on the light tile, white on the dark ones. |
| Notion | `#000000` | `#000000` | `#FFFFFF` | One-colour mark: black on the light tile, the white version on the dark ones. |
| Supabase | `#3FCF8E` | `#000000` | `#3FCF8E` | Brand green on the dark tiles; the green is 1.96:1 on the light tile, so the one-colour black version there. |
| Brave | `#FB542B` | `#FB542B` | `#FB542B` | Brand orange on every tile (3.23:1 on the light one, 4.9 or more on the dark ones). |
| Atlassian | `#0052CC` | `#0052CC` | `#FFFFFF` | Atlassian blue on the light tile; the blue is 2.35:1 on the dark tiles, so the white logo there, as Atlassian's logo guidelines do on dark backgrounds. |
| MongoDB | `#47A248` | `#47A248` | `#47A248` | Brand green on every tile (3.16:1 on the light one, 4.99 or more on the dark ones). |
| Sentry | `#362D59` | `#362D59` | `#FFFFFF` | Sentry purple on the light tile; on the dark tiles it is 1.28:1, so the white version Sentry's branding page offers. |
| Neon | `#34D59A` | `#000000` | `#34D59A` | Brand green on the dark tiles; 1.86:1 on the light tile, so the one-colour black version there. |
| Google Chrome | `#4285F4` | `#4285F4` | `#4285F4` | Simple Icons' one-colour Chrome in Google blue (the official logo is four colours; Simple Icons carries one path), 3.51:1 or more everywhere. |
| Google | `#4285F4` | `#4285F4` | `#4285F4` | Simple Icons' one-colour G in Google blue (the official G is four colours; Simple Icons carries one path), 3.51:1 or more everywhere. |
| Anthropic | `#191919` | `#191919` | `#FFFFFF` | Anthropic's near-black on the light tile; the white version on the dark ones (1.09:1 otherwise). |
| Vercel | `#000000` | `#000000` | `#FFFFFF` | Vercel's mark is black or white (vercel.com/geist/brands): black on the light tile, white on the dark ones. |
| Upstash | `#00E9A3` | `#000000` | `#00E9A3` | Brand green on the dark tiles; 1.57:1 on the light tile, so the one-colour black version there. |
| Model Context Protocol | `#000000` | `#000000` | `#FFFFFF` | One-colour mark (the project publishes light.svg and dark.svg): black on the light tile, white on the dark ones. |

## Adding a mark

1. Copy the file from the same Simple Icons version unchanged into `svg/`, after checking its data entry has no other
   licence, and read the brand's guidelines.
2. Add its entry to `map.json` with only evidence that is in boopis's data (a collection id, a host the collection or a
   registry lists, a package it runs, a publisher's exact name). Never a guess from a name alone. Give it `color.light`
   and `color.dark`: the brand's `hex` where it holds 3:1 on that tile, else its black or white version, and say why.
3. Add a row above, and a case to `components/item-mark.test.ts`.
