# Service marks

The logos the Store and Settings > Connectors draw on an item's tile: the mark of the service a connector connects to,
and a publisher's mark beside the publisher's name. They are drawn in one colour, `currentColor`, like the model marks
(DESIGN-SYSTEM.md 10.1): the theme's tokens colour them, and no brand colour is shown.

## What is here

- `svg/*.svg`: the icon files, copied unchanged from the source below (one path each, a 24-unit viewBox, a `<title>`).
  The component reads the path and draws it in `currentColor`; the file itself is never edited.
- `map.json`: which item gets which mark, and why (`rule`). It names the evidence a match needs (an id in boopis's
  collection, an address's host, a package or image, a home page's host, a publisher's name) and nothing else. An item
  with no match gets a monogram, never a look-alike.

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
Thinking and Memory (the reference servers have the publisher's mark beside their publisher, not on their tile).

**To check before release** (as ADR-0040 does for the sign-in marks): Anthropic's trademark guidelines ask for prior
permission for other uses of its marks; GitHub allows its logo to indicate an integration. Remove a file and its
`map.json` entry if a brand objects; its items fall back to monograms.

## Adding a mark

1. Copy the file from the same Simple Icons version unchanged into `svg/`, after checking its data entry has no other
   licence, and read the brand's guidelines.
2. Add its entry to `map.json` with only evidence that is in boopis's data (a collection id, a host the collection or a
   registry lists, a package it runs). Never a guess from a name alone.
3. Add a row above, and a case to `components/item-mark.test.ts`.
