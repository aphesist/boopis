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
| `github.svg` | GitHub | https://github.com/logos | https://github.com/logos | the github connector; publisher GitHub |
| `notion.svg` | Notion | https://www.notion.so | none listed | the notion connector; publisher Notion |
| `supabase.svg` | Supabase | https://github.com/supabase/supabase/blob/4031a7549f5d46da7bc79c01d56be4177dc7c114/packages/common/assets/images/supabase-logo-wordmark--light.svg | none listed | the supabase connector; publisher Supabase |
| `brave.svg` | Brave | https://brave.com/brave-branding-assets | https://brave.com/brave-branding-assets | the brave-search connector; publisher Brave |
| `atlassian.svg` | Atlassian | https://atlassian.design/resources/logo-library | https://atlassian.design/foundations/logos | the atlassian connector; publisher Atlassian |
| `mongodb.svg` | MongoDB | https://www.mongodb.com/pressroom | none listed | the mongodb connector; publisher MongoDB |
| `sentry.svg` | Sentry | https://sentry.io/branding/ | none listed | the sentry connector; publisher Sentry |
| `neon.svg` | Neon | https://neon.com/brand | https://neon.com/brand | the neon connector; publisher Neon |
| `googlechrome.svg` | Google Chrome | https://www.google.com/chrome | https://partnermarketinghub.withgoogle.com/brands/chrome | the chrome-devtools connector |
| `google.svg` | Google | https://partnermarketinghub.withgoogle.com | https://about.google/brand-resource-center/brand-elements/ | publisher Google, Google (Chrome DevTools) |
| `anthropic.svg` | Anthropic | https://www.anthropic.com | none listed | publisher Anthropic |
| `vercel.svg` | Vercel | https://vercel.com/geist/brands | https://vercel.com/geist/brands | the vercel connector; publisher Vercel |
| `upstash.svg` | Upstash | https://upstash.com | none listed | publisher Upstash |
| `modelcontextprotocol.svg` | Model Context Protocol | https://github.com/modelcontextprotocol/docs/blob/573dc60c2e7aab2605b29d0bf27194aa7b02e4fb/logo/light.svg | none listed | the sequential-thinking, memory, filesystem, fetch, time, everything connectors; publisher Model Context Protocol, Model Context Protocol (reference servers) |
| `linear.svg` | Linear | https://linear.app | none listed | the linear connector; publisher Linear |
| `postgresql.svg` | PostgreSQL | https://wiki.postgresql.org/wiki/Logo | https://www.postgresql.org/about/policies/trademarks/ | the postgres, postgresql connectors |
| `sqlite.svg` | SQLite | https://github.com/sqlite/sqlite/blob/43e862723ec680542ca6f608f9963c0993dd7324/art/sqlite370.eps | none listed | the sqlite connector |
| `googledrive.svg` | Google Drive | https://developers.google.com/drive/web/branding | none listed | the google-drive, gdrive connectors |
| `jira.svg` | Jira | https://atlassian.design/resources/logo-library | https://atlassian.design/foundations/logos/ | the jira connector |
| `confluence.svg` | Confluence | https://www.atlassian.com/company/news/press-kit | none listed | the confluence connector |
| `gitlab.svg` | GitLab | https://about.gitlab.com/press/press-kit/ | https://about.gitlab.com/handbook/marketing/corporate-marketing/brand-activation/trademark-guidelines/ | the gitlab connector; publisher GitLab |
| `docker.svg` | Docker | https://www.docker.com/company/newsroom/media-resources | none listed | the docker connector; publisher Docker |
| `puppeteer.svg` | Puppeteer | https://pptr.dev | none listed | the puppeteer connector |
| `redis.svg` | Redis | https://redis.io/brand-guidelines | https://redis.io/brand-guidelines | the redis connector; publisher Redis |
| `mysql.svg` | MySQL | https://www.mysql.com/about/legal/logos.html | https://www.mysql.com/about/legal/logos.html | the mysql connector |
| `stripe.svg` | Stripe | https://stripe.com/newsroom/information | none listed | the stripe connector; publisher Stripe |
| `figma.svg` | Figma | https://www.figma.com/using-the-figma-brand/ | https://www.figma.com/using-the-figma-brand/ | the figma connector; publisher Figma |
| `cloudflare.svg` | Cloudflare | https://www.cloudflare.com/logo/ | https://www.cloudflare.com/trademark/ | the cloudflare connector; publisher Cloudflare |
| `discord.svg` | Discord | https://discord.com/branding | https://discord.com/branding | the discord connector |
| `asana.svg` | Asana | https://asana.com/brand | https://asana.com/brand | the asana connector; publisher Asana |
| `trello.svg` | Trello | https://atlassian.design/resources/logo-library | https://atlassian.design/foundations/logos | the trello connector |
| `airtable.svg` | Airtable | https://airtable.com/newsroom | none listed | the airtable connector |
| `obsidian.svg` | Obsidian | https://obsidian.md | https://obsidian.md/brand | the obsidian connector |
| `todoist.svg` | Todoist | https://doist.com/press | none listed | the todoist connector |
| `gmail.svg` | Gmail | https://fonts.gstatic.com/s/i/productlogos/gmail_2020q4/v8/192px.svg | none listed | the gmail connector |
| `googlecalendar.svg` | Google Calendar | https://fonts.gstatic.com/s/i/productlogos/calendar_2020q4/v8/192px.svg | none listed | the google-calendar, gcal connectors |
| `googlemaps.svg` | Google Maps | https://commons.wikimedia.org/wiki/File:Google_Maps_icon.svg | none listed | the google-maps connector |
| `kubernetes.svg` | Kubernetes | https://github.com/kubernetes/kubernetes/tree/cac53883f4714452f3084a22e4be20d042a9df33/logo | none listed | the kubernetes, k8s connectors |
| `grafana.svg` | Grafana | https://grafana.com | none listed | the grafana connector; publisher Grafana Labs |
| `datadog.svg` | Datadog | https://www.datadoghq.com/about/resources | https://www.datadoghq.com/about/resources/ | the datadog connector; publisher Datadog |
| `pagerduty.svg` | PagerDuty | https://www.pagerduty.com/brand/ | https://www.pagerduty.com/brand/ | the pagerduty connector |
| `hubspot.svg` | HubSpot | https://www.hubspot.com/style-guide | https://www.hubspot.com/style-guide | the hubspot connector |
| `zapier.svg` | Zapier | https://www.figma.com/file/NQFxTCE5pGR3dHZt0DkOyy/Zapier-Brand-Guidelines-%5BExternal%5D?type=design&node-id=101-9701&mode=design | https://www.figma.com/file/NQFxTCE5pGR3dHZt0DkOyy/Zapier-Brand-Guidelines-%5BExternal%5D?type=design&node-id=101-9701&mode=design | the zapier connector; publisher Zapier |
| `shopify.svg` | Shopify | https://www.shopify.com/brand-assets | https://www.shopify.com/brand-assets | the shopify connector |
| `netlify.svg` | Netlify | https://www.netlify.com/about/#brand-assets | https://www.netlify.com/about/#brand-assets | the netlify connector; publisher Netlify |
| `perplexity.svg` | Perplexity | https://www.perplexity.ai | none listed | the perplexity connector |
| `duckduckgo.svg` | DuckDuckGo | https://github.com/duckduckgo/duckduckgo-privacy-extension/blob/5c6ac8d6a07421adbfb97ee2ff855dd7655f8d71/shared/img/logo-small-grayscale.svg | https://duckduckgo.com/press#press-materials | the duckduckgo connector |
| `elasticsearch.svg` | Elasticsearch | https://www.elastic.co/brand | none listed | the elasticsearch connector |
| `bitbucket.svg` | Bitbucket | https://atlassian.design/resources/logo-library | https://atlassian.design/foundations/logos | the bitbucket connector |

Not found in the source, so drawn as letters: Context7, Playwright (and Microsoft), Firecrawl, Exa, Slack and Tavily. Git's
icon is in the source but under CC BY 3.0, not CC0, so it is not copied and a git connector keeps its letters. The reference servers
(Memory, Sequential Thinking, Fetch, Filesystem, Time, Everything) are the Model Context Protocol project's own, so they carry its mark
as their service.

Second copy, 27 November 2026: the files added for the owner's decision on conflict 30 ("Real logos, obviously. They should be
coloured too.") come from the same version, `npm pack simple-icons@16.38.1` into a scratch directory; each one's data entry was
checked to carry no licence of its own.

**To check before release** (as ADR-0040 does for the sign-in marks): Anthropic's trademark guidelines ask for prior
permission for other uses of its marks; GitHub allows its logo to indicate an integration. Remove a file and its
`map.json` entry if a brand objects; its items fall back to monograms.

## Colours

Each brand's official colour is Simple Icons' `hex` for the icon (its data file, version above). A mark stands on the kit's tiles:
v6's raised tile `--bg-3` (`#fffdf8` in Bone, `#23211e` in Card catalog, `#1f1f1f` in Graphite and Typewriter) and v7's item tile
`--bg-4` and pane Card `--bg-3` (`#f1f1f1` and `#ffffff` light, `#2c2c2c` and `#1f1f1f` dark). A mark must hold 3:1 against every tile
of its scheme (WCAG 1.4.11, the system's floor for marks).

- Where the brand colour does, it is drawn as it is.
- Where it does not, the same hue and saturation is drawn with its lightness moved (darker on the light tiles, lighter on the dark
  ones) until it does (the owner, 27 November 2026: Supabase is its green on the light theme, not black).
- A one-colour brand (Simple Icons gives black or near black: GitHub, Notion, Vercel, Anthropic, Netlify, Model Context Protocol)
  is `ink`: the theme's text colour (`--text`), so it follows the theme as the words beside it do.

No file is recoloured: the colour is applied to the unchanged path through `currentColor`. Google's G, Chrome, Drive, Gmail, Calendar
and Maps are several colours officially; Simple Icons carries one path, drawn in Google blue. The test is
`components/item-mark.test.ts` ("every mark holds 3:1 against every tile of its scheme").

| Mark | Simple Icons `hex` | On the light tiles | On the dark tiles | Why |
|---|---|---|---|---|
| GitHub | `#181717` | ink | ink | GitHub is a one-colour mark (Simple Icons #181717): drawn in the theme's ink, so it follows the theme as text does. |
| Notion | `#000000` | ink | ink | Notion is a one-colour mark (Simple Icons #000000): drawn in the theme's ink, so it follows the theme as text does. |
| Supabase | `#3FCF8E` | `#279D68` | `#3FCF8E` | Supabase's own colour (Simple Icons #3FCF8E); on the light tiles the brand #3FCF8E is 1.77:1, so its own hue darkened to #279D68 (3:1). |
| Brave | `#FB542B` | `#FB4C21` | `#FB542B` | Brave's own colour (Simple Icons #FB542B); on the light tiles the brand #FB542B is 2.90:1, so its own hue darkened to #FB4C21 (3:1). |
| Atlassian | `#0052CC` | `#0052CC` | `#056AFF` | Atlassian's own colour (Simple Icons #0052CC); on the dark tiles the brand #0052CC is 2.05:1, so its own hue lightened to #056AFF (3:1). |
| MongoDB | `#47A248` | `#459D46` | `#47A248` | MongoDB's own colour (Simple Icons #47A248); on the light tiles the brand #47A248 is 2.85:1, so its own hue darkened to #459D46 (3:1). |
| Sentry | `#362D59` | `#362D59` | `#7A6BB4` | Sentry's own colour (Simple Icons #362D59); on the dark tiles the brand #362D59 is 1.11:1, so its own hue lightened to #7A6BB4 (3:1). |
| Neon | `#34D59A` | `#219E70` | `#34D59A` | Neon's own colour (Simple Icons #34D59A); on the light tiles the brand #34D59A is 1.67:1, so its own hue darkened to #219E70 (3:1). |
| Google Chrome | `#4285F4` | `#4285F4` | `#4285F4` | Google Chrome's own colour (Simple Icons #4285F4), 3:1 or more on every tile. |
| Google | `#4285F4` | `#4285F4` | `#4285F4` | Google's own colour (Simple Icons #4285F4), 3:1 or more on every tile. |
| Anthropic | `#191919` | ink | ink | Anthropic is a one-colour mark (Simple Icons #191919): drawn in the theme's ink, so it follows the theme as text does. |
| Vercel | `#000000` | ink | ink | Vercel is a one-colour mark (Simple Icons #000000): drawn in the theme's ink, so it follows the theme as text does. |
| Upstash | `#00E9A3` | `#009F6F` | `#00E9A3` | Upstash's own colour (Simple Icons #00E9A3); on the light tiles the brand #00E9A3 is 1.41:1, so its own hue darkened to #009F6F (3:1). |
| Model Context Protocol | `#000000` | ink | ink | Model Context Protocol is a one-colour mark (Simple Icons #000000): drawn in the theme's ink, so it follows the theme as text does. |
| Linear | `#5E6AD2` | `#5E6AD2` | `#606CD3` | Linear's own colour (Simple Icons #5E6AD2); on the dark tiles the brand #5E6AD2 is 2.97:1, so its own hue lightened to #606CD3 (3:1). |
| PostgreSQL | `#4169E1` | `#4169E1` | `#486EE2` | PostgreSQL's own colour (Simple Icons #4169E1); on the dark tiles the brand #4169E1 is 2.88:1, so its own hue lightened to #486EE2 (3:1). |
| SQLite | `#003B57` | `#003B57` | `#007DB8` | SQLite's own colour (Simple Icons #003B57); on the dark tiles the brand #003B57 is 1.17:1, so its own hue lightened to #007DB8 (3:1). |
| Google Drive | `#4285F4` | `#4285F4` | `#4285F4` | Google Drive's own colour (Simple Icons #4285F4), 3:1 or more on every tile. |
| Jira | `#0052CC` | `#0052CC` | `#056AFF` | Jira's own colour (Simple Icons #0052CC); on the dark tiles the brand #0052CC is 2.05:1, so its own hue lightened to #056AFF (3:1). |
| Confluence | `#172B4D` | `#172B4D` | `#4374C7` | Confluence's own colour (Simple Icons #172B4D); on the dark tiles the brand #172B4D is 1.01:1, so its own hue lightened to #4374C7 (3:1). |
| GitLab | `#FC6D26` | `#F65403` | `#FC6D26` | GitLab's own colour (Simple Icons #FC6D26); on the light tiles the brand #FC6D26 is 2.53:1, so its own hue darkened to #F65403 (3:1). |
| Docker | `#2496ED` | `#168FEC` | `#2496ED` | Docker's own colour (Simple Icons #2496ED); on the light tiles the brand #2496ED is 2.79:1, so its own hue darkened to #168FEC (3:1). |
| Puppeteer | `#40B5A4` | `#36998A` | `#40B5A4` | Puppeteer's own colour (Simple Icons #40B5A4); on the light tiles the brand #40B5A4 is 2.22:1, so its own hue darkened to #36998A (3:1). |
| Redis | `#FF4438` | `#FF4438` | `#FF4438` | Redis's own colour (Simple Icons #FF4438), 3:1 or more on every tile. |
| MySQL | `#4479A1` | `#4479A1` | `#457AA3` | MySQL's own colour (Simple Icons #4479A1); on the dark tiles the brand #4479A1 is 2.99:1, so its own hue lightened to #457AA3 (3:1). |
| Stripe | `#635BFF` | `#635BFF` | `#655EFF` | Stripe's own colour (Simple Icons #635BFF); on the dark tiles the brand #635BFF is 2.97:1, so its own hue lightened to #655EFF (3:1). |
| Figma | `#F24E1E` | `#F24E1E` | `#F24E1E` | Figma's own colour (Simple Icons #F24E1E), 3:1 or more on every tile. |
| Cloudflare | `#F38020` | `#DC6A0C` | `#F38020` | Cloudflare's own colour (Simple Icons #F38020); on the light tiles the brand #F38020 is 2.35:1, so its own hue darkened to #DC6A0C (3:1). |
| Discord | `#5865F2` | `#5865F2` | `#5865F2` | Discord's own colour (Simple Icons #5865F2), 3:1 or more on every tile. |
| Asana | `#F06A6A` | `#EE5757` | `#F06A6A` | Asana's own colour (Simple Icons #F06A6A); on the light tiles the brand #F06A6A is 2.67:1, so its own hue darkened to #EE5757 (3:1). |
| Trello | `#0052CC` | `#0052CC` | `#056AFF` | Trello's own colour (Simple Icons #0052CC); on the dark tiles the brand #0052CC is 2.05:1, so its own hue lightened to #056AFF (3:1). |
| Airtable | `#18BFFF` | `#0094CD` | `#18BFFF` | Airtable's own colour (Simple Icons #18BFFF); on the light tiles the brand #18BFFF is 1.87:1, so its own hue darkened to #0094CD (3:1). |
| Obsidian | `#7C3AED` | `#7C3AED` | `#8C51EF` | Obsidian's own colour (Simple Icons #7C3AED); on the dark tiles the brand #7C3AED is 2.45:1, so its own hue lightened to #8C51EF (3:1). |
| Todoist | `#E44332` | `#E44332` | `#E44332` | Todoist's own colour (Simple Icons #E44332), 3:1 or more on every tile. |
| Gmail | `#EA4335` | `#EA4335` | `#EA4335` | Gmail's own colour (Simple Icons #EA4335), 3:1 or more on every tile. |
| Google Calendar | `#4285F4` | `#4285F4` | `#4285F4` | Google Calendar's own colour (Simple Icons #4285F4), 3:1 or more on every tile. |
| Google Maps | `#4285F4` | `#4285F4` | `#4285F4` | Google Maps's own colour (Simple Icons #4285F4), 3:1 or more on every tile. |
| Kubernetes | `#326CE5` | `#326CE5` | `#376FE6` | Kubernetes's own colour (Simple Icons #326CE5); on the dark tiles the brand #326CE5 is 2.93:1, so its own hue lightened to #376FE6 (3:1). |
| Grafana | `#F46800` | `#E76300` | `#F46800` | Grafana's own colour (Simple Icons #F46800); on the light tiles the brand #F46800 is 2.72:1, so its own hue darkened to #E76300 (3:1). |
| Datadog | `#632CA6` | `#632CA6` | `#9058D3` | Datadog's own colour (Simple Icons #632CA6); on the dark tiles the brand #632CA6 is 1.62:1, so its own hue lightened to #9058D3 (3:1). |
| PagerDuty | `#06AC38` | `#06A034` | `#06AC38` | PagerDuty's own colour (Simple Icons #06AC38); on the light tiles the brand #06AC38 is 2.67:1, so its own hue darkened to #06A034 (3:1). |
| HubSpot | `#FF7A59` | `#FF4719` | `#FF7A59` | HubSpot's own colour (Simple Icons #FF7A59); on the light tiles the brand #FF7A59 is 2.27:1, so its own hue darkened to #FF4719 (3:1). |
| Zapier | `#FF4F00` | `#FA4D00` | `#FF4F00` | Zapier's own colour (Simple Icons #FF4F00); on the light tiles the brand #FF4F00 is 2.92:1, so its own hue darkened to #FA4D00 (3:1). |
| Shopify | `#7AB55C` | `#619945` | `#7AB55C` | Shopify's own colour (Simple Icons #7AB55C); on the light tiles the brand #7AB55C is 2.16:1, so its own hue darkened to #619945 (3:1). |
| Netlify | `#000000` | ink | ink | Netlify is a one-colour mark (Simple Icons #000000): drawn in the theme's ink, so it follows the theme as text does. |
| Perplexity | `#1FB8CD` | `#1A98AA` | `#1FB8CD` | Perplexity's own colour (Simple Icons #1FB8CD); on the light tiles the brand #1FB8CD is 2.11:1, so its own hue darkened to #1A98AA (3:1). |
| DuckDuckGo | `#DE5833` | `#DE5833` | `#DE5833` | DuckDuckGo's own colour (Simple Icons #DE5833), 3:1 or more on every tile. |
| Elasticsearch | `#005571` | `#005571` | `#007FA9` | Elasticsearch's own colour (Simple Icons #005571); on the dark tiles the brand #005571 is 1.69:1, so its own hue lightened to #007FA9 (3:1). |
| Bitbucket | `#0052CC` | `#0052CC` | `#056AFF` | Bitbucket's own colour (Simple Icons #0052CC); on the dark tiles the brand #0052CC is 2.05:1, so its own hue lightened to #056AFF (3:1). |

## Adding a mark

1. Copy the file from the same Simple Icons version unchanged into `svg/`, after checking its data entry has no other
   licence, and read the brand's guidelines.
2. Add its entry to `map.json` with only evidence that is in boopis's data (a collection id or a connector's own name, read as
   one key by `connectorKey`; a host the collection or a registry lists; a package it runs; a publisher's exact name). A
   connector's name decides only when what it runs names no listed service. Give it `color.light`
   and `color.dark`: the brand's `hex` where it holds 3:1 on every tile of that scheme, else its hue with the lightness moved
   until it does, or `ink` for a one-colour brand, and say why.
3. Add a row above, and a case to `components/item-mark.test.ts`.
