/* Item marks: the service a connector connects to, found only from evidence in the data (its collection id, its address's host,
   the package or image it runs, a store item's home page), a publisher's mark by the publisher's exact name, and a monogram for
   everything else, the same letters every time. */
import { describe, expect, it } from 'vitest';
import collection from '../../../../shared/data/connectors.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandMarkHTML, connectorKey, itemTile, monogram, packageOf, publisherMarkOf, serviceMark, serviceMarkOf, serviceMarks, tileMarkOf } from './item-mark';
import mapFile from '../vendor/service-marks/map.json';
import { lum, ratio } from '../styles/colour';

const id = (m: { id: string } | null): string | null => (m ? m.id : null);

describe('the vendored marks', () => {
  it('every entry of the map has its file, with a path to draw and no fill of its own', () => {
    const entries = (mapFile as unknown as { marks: { id: string }[] }).marks;
    expect(serviceMarks().map((m) => m.id).sort()).toEqual(entries.map((e) => e.id).sort());
    for (const m of serviceMarks()) {
      expect(m.body, m.id).toMatch(/^<path d="/);
      expect(m.body, m.id).not.toMatch(/<title>|fill=|style=/);
      expect(m.viewBox, m.id).toBe('0 0 24 24');
    }
  });
  it('lists no code host, where anyone can publish', () => {
    for (const e of (mapFile as unknown as { marks: { hosts: string[] }[] }).marks) for (const h of e.hosts) expect(['github.com', 'gitlab.com', 'npmjs.com', 'registry.npmjs.org']).not.toContain(h);
  });
});

describe('serviceMarkOf: evidence, never a guess', () => {
  it('a connector of boopis\'s collection by its id', () => {
    expect(id(serviceMarkOf({ name: 'GitHub', collection: 'github' }))).toBe('github');
    expect(id(serviceMarkOf({ name: 'Chrome DevTools', collection: 'chrome-devtools' }))).toBe('googlechrome');
    expect(id(serviceMarkOf({ name: 'Brave Search', collection: 'brave-search', kind: 'connector' }))).toBe('brave');
  });
  it('the collection\'s entries each get the mark the map gives, or none (Context7, Playwright, Firecrawl and Exa have none in Simple Icons; the reference servers are the protocol\'s own)', () => {
    const got = Object.fromEntries((collection as unknown as { connectors: { id: string; name: string }[] }).connectors.map((c) => [c.id, id(serviceMarkOf({ name: c.name, collection: c.id }))]));
    expect(got).toEqual({
      context7: null, 'chrome-devtools': 'googlechrome', playwright: null, github: 'github', firecrawl: null, exa: null, notion: 'notion', supabase: 'supabase',
      'brave-search': 'brave', atlassian: 'atlassian', mongodb: 'mongodb', sentry: 'sentry', neon: 'neon', 'sequential-thinking': 'modelcontextprotocol', memory: 'modelcontextprotocol'
    });
  });
  it('an installed connector by what it runs: its address, its package or its image', () => {
    expect(id(serviceMarkOf({ name: 'mine', url: 'https://mcp.notion.com/mcp' }))).toBe('notion');
    expect(id(serviceMarkOf({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/' }))).toBe('github');
    expect(id(serviceMarkOf({ name: 'x', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server@2.2.0'] }))).toBe('brave');
    expect(id(serviceMarkOf({ name: 'x', command: 'npx', args: ['-y', 'mongodb-mcp-server@3.3.0', '--readOnly'] }))).toBe('mongodb');
    expect(id(serviceMarkOf({ name: 'x', command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server@sha256:040c4e'] }))).toBe('github');
  });
  it('what it runs outranks its name where it names a listed service: a server called github that runs Notion\'s is Notion', () => {
    expect(id(serviceMarkOf({ name: 'github', collection: 'github', url: 'https://mcp.notion.com/mcp' }))).toBe('notion');
    expect(id(serviceMarkOf({ name: 'notes', collection: 'notes', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] }))).toBe('postgresql');
  });
  it('where what it runs names no listed service, its name decides, as one key (an installed "github" behind a proxy is GitHub)', () => {
    expect(id(serviceMarkOf({ name: 'github', collection: 'github', command: 'npx', args: ['-y', 'notes-mcp@1.2.3'] }))).toBe('github');
    expect(id(serviceMarkOf({ name: 'notion', collection: 'notion', url: 'https://mcp.example.com/mcp' }))).toBe('notion');
    expect(id(serviceMarkOf({ name: 'GitHub MCP', collection: 'GitHub MCP' }))).toBe('github');
    expect(id(serviceMarkOf({ name: 'google-drive', collection: 'Google Drive' }))).toBe('googledrive');
    expect(id(serviceMarkOf({ name: 'postgres', collection: 'postgres' }))).toBe('postgresql');
    expect(serviceMarkOf({ name: 'notes', collection: 'notes', url: 'https://mcp.example.com/mcp' })).toBeNull();
  });
  it('the pane\'s common connectors each have their mark; Slack, Playwright and the rest Simple Icons lacks keep their letters', () => {
    const got = Object.fromEntries(['github', 'postgres', 'linear', 'sentry', 'sqlite', 'filesystem', 'fetch', 'memory', 'jira', 'gitlab', 'slack', 'playwright', 'context7', 'exa', 'firecrawl'].map((n) => [n, id(serviceMarkOf({ name: n, collection: n }))]));
    expect(got).toEqual({ github: 'github', postgres: 'postgresql', linear: 'linear', sentry: 'sentry', sqlite: 'sqlite', filesystem: 'modelcontextprotocol', fetch: 'modelcontextprotocol', memory: 'modelcontextprotocol', jira: 'jira', gitlab: 'gitlab', slack: null, playwright: null, context7: null, exa: null, firecrawl: null });
  });
  it('without anything it runs (the session knows only the name), the name the collection gave it decides', () => {
    expect(id(serviceMarkOf({ name: 'sentry', collection: 'sentry' }))).toBe('sentry');
    expect(serviceMarkOf({ name: 'notes', collection: 'notes' })).toBeNull();
  });
  it('a store connector by its home page\'s host, never a code host', () => {
    expect(id(serviceMarkOf({ name: 'Notion MCP', kind: 'connector', homepage: 'https://developers.notion.com/docs/mcp' }))).toBe('notion');
    expect(serviceMarkOf({ name: 'GitHub thing', kind: 'connector', homepage: 'https://github.com/github/github-mcp-server' })).toBeNull();
  });
  it('a skill, plugin or mod is content with a name: never a service mark, whatever its id or home page', () => {
    expect(serviceMarkOf({ name: 'Supabase Postgres Best Practices', kind: 'skill', collection: 'supabase', homepage: 'https://supabase.com/docs' })).toBeNull();
    expect(serviceMarkOf({ name: 'GitHub', kind: 'plugin', collection: 'github' })).toBeNull();
  });
  it('an address it cannot read is no evidence', () => {
    expect(serviceMarkOf({ name: 'x', url: 'not a url' })).toBeNull();
  });
});

describe('connectorKey', () => {
  it('case, a scope, separators and the words mcp and server aside', () => {
    expect(connectorKey('GitHub')).toBe('github');
    expect(connectorKey('github-mcp')).toBe('github');
    expect(connectorKey('@acme/github-mcp-server')).toBe('github');
    expect(connectorKey('Brave Search')).toBe(connectorKey('brave-search'));
    expect(connectorKey('boopis:google-drive')).toBe('googledrive');
    expect(connectorKey('mcp')).toBe('');
  });
});

describe('itemTile: the one rule every item row draws', () => {
  it('a mod\'s glyph, a brand\'s mark, else the letters', () => {
    expect('markHTML' in itemTile({ name: 'Focus theme', kind: 'mod' }) && itemTile({ name: 'Focus theme', kind: 'mod' })).toMatchObject({ markHTML: expect.stringContaining('<svg') });
    expect(itemTile({ name: 'github', collection: 'github' })).toMatchObject({ markHTML: expect.stringContaining('data-mark="github"') });
    expect(itemTile({ name: 'Frontend design', kind: 'skill', publisher: 'Anthropic', proven: true })).toMatchObject({ markHTML: expect.stringContaining('data-mark-of="publisher"') });
    expect(itemTile({ name: 'Context7', collection: 'context7' })).toEqual({ markText: 'C7' });
    expect(itemTile({ name: 'pw', collection: 'pw' }, 'Playwright')).toEqual({ markText: 'PL' });
  });
});

describe('packageOf', () => {
  it('drops a version, a tag or a digest, and skips flags', () => {
    expect(packageOf('@upstash/context7-mcp@4.7.3')).toBe('@upstash/context7-mcp');
    expect(packageOf('firecrawl-mcp@3.40.0')).toBe('firecrawl-mcp');
    expect(packageOf('ghcr.io/github/github-mcp-server@sha256:abc')).toBe('ghcr.io/github/github-mcp-server');
    expect(packageOf('ghcr.io/owner/image:1.2')).toBe('ghcr.io/owner/image');
    expect(packageOf('localhost:5000/image')).toBe('localhost:5000/image');
    expect(packageOf('--readOnly')).toBe('');
  });
});

describe('publisherMarkOf', () => {
  it('by the publisher\'s exact name, case aside', () => {
    expect(id(publisherMarkOf('Anthropic'))).toBe('anthropic');
    expect(id(publisherMarkOf('vercel'))).toBe('vercel');
    expect(id(publisherMarkOf('Google (Chrome DevTools)'))).toBe('google');
    expect(id(publisherMarkOf('Model Context Protocol (reference servers)'))).toBe('modelcontextprotocol');
  });
  it('no mark for a name the kit does not carry, or one that only resembles it', () => {
    expect(publisherMarkOf('Matt Pocock')).toBeNull();
    expect(publisherMarkOf('Anthropic Fan Club')).toBeNull();
    expect(publisherMarkOf('')).toBeNull();
  });
});

describe('monogram', () => {
  it('the first letters of the first two words, small words skipped, one letter for one word', () => {
    expect(monogram('Frontend Design')).toBe('FD');
    expect(monogram('Firecrawl')).toBe('F');
    expect(monogram('pdf')).toBe('P');
    expect(monogram('A connector with an extremely long name')).toBe('CE');
    expect(monogram('Sequential Thinking')).toBe('ST');
    expect(monogram('brave-search')).toBe('BS');
    expect(monogram('Context7')).toBe('C');
  });
  it('the same letters every time, and from the id when the name has none', () => {
    expect(monogram('Release notes')).toBe(monogram('Release notes'));
    expect(monogram('—', 'skills-hub:example-org/sql-review')).toBe('EO');
    expect(monogram('', '')).toBe('?');
  });
  it('keeps a letter outside Latin whole', () => {
    expect(monogram('Ünïcode Ωmega')).toBe('ÜΩ');
  });
});

describe('the mark', () => {
  it('draws the service\'s mark in currentColor, hidden from assistive tech (its name sits beside it)', () => {
    const h = brandMarkHTML({ name: 'GitHub', collection: 'github' }) ?? '';
    expect(h).toContain('data-mark="github"');
    expect(h).toContain('fill="currentColor"');
    expect(h).toContain('data-brand style="--mk-l:var(--text);--mk-d:var(--text)"');
    expect(h).toContain('aria-hidden="true"');
  });
  it('draws nothing where no mark is known: the tile shows its letters', () => {
    expect(brandMarkHTML({ name: 'Release notes', kind: 'skill' })).toBeNull();
    expect(itemTile({ name: 'Release notes', kind: 'skill' })).toEqual({ markText: 'RN' });
  });
});

describe('brand colours (owner decisions, 23 and 27 November 2026)', () => {
  /* the tiles a mark stands on: v6's raised tile (--bg-3) of every preset, read from tokens.css with its scheme as theme.ts decides it
     (the ground's luminance), and v7's: the ListRow's item tile (--bg-4) and the pane's Card (--bg-3), dark and light (tokens.v7.css) */
  const css = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');
  const v7 = readFileSync(join(__dirname, '..', 'styles', 'tokens.v7.css'), 'utf8');
  const tokOf = (block: string, n: string): string => new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})').exec(block)?.[1] ?? '';
  const presets = ['catalog', 'graphite', 'bone', 'typewriter'].map((id) => {
    const block = new RegExp('\\[data-hx-preset="' + id + '"\\][^{]*\\{([^}]*)\\}').exec(css)?.[1] ?? '';
    return { id, tiles: [tokOf(block, 'bg-3')], light: lum(tokOf(block, 'bg-2')) > 0.4 };
  });
  for (const scheme of ['dark', 'light'] as const) {
    const block = new RegExp('\\[data-ui="v7"\\]\\[data-theme="' + scheme + '"\\][^{]*\\{([^}]*)\\}').exec(v7)?.[1] ?? '';
    presets.push({ id: 'v7 ' + scheme, tiles: [tokOf(block, 'bg-4'), tokOf(block, 'bg-3')], light: scheme === 'light' });
  }
  const hue = (hex: string): { h: number; s: number } => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) };
  };
  it('reads the tiles of every preset and of v7, and Bone and v7 light are the light ones', () => {
    for (const p of presets) for (const t of p.tiles) expect(t, p.id).toMatch(/^#[0-9a-f]{6}$/i);
    expect(presets.filter((p) => p.light).map((p) => p.id)).toEqual(['bone', 'v7 light']);
  });
  it('every mark holds 3:1 against every tile of its scheme, in the colour that scheme draws (WCAG 1.4.11); ink is the text colour', () => {
    for (const m of serviceMarks()) for (const p of presets) for (const t of p.tiles) {
      const c = p.light ? m.light : m.dark;
      if (c === 'ink') continue;
      expect(ratio(c, t), `${m.id} on ${p.id} (${c} on ${t})`).toBeGreaterThanOrEqual(3);
    }
  });
  it('each colour is the brand\'s own hue (Simple Icons\' hex, or its lightness moved to reach 3:1), or ink for a one-colour brand, with the reason written down', () => {
    for (const e of (mapFile as unknown as { marks: { id: string; hex: string; color: { light: string; dark: string; why: string } }[] }).marks) {
      const own = hue('#' + e.hex);
      for (const c of [e.color.light, e.color.dark]) {
        if (c === 'ink') { expect(own.s, e.id + ' is one colour').toBeLessThan(0.1); continue; }
        const got = hue(c);
        expect(Math.abs(got.h - own.h), e.id + ' keeps its hue').toBeLessThan(3);
        expect(Math.abs(got.s - own.s), e.id + ' keeps its saturation').toBeLessThan(0.08);
      }
      expect(e.color.why.length, e.id).toBeGreaterThan(20);
    }
  });
  it('a one-colour brand follows the theme\'s ink; a pale brand keeps its hue on the light tiles (Supabase green, not black)', () => {
    expect(serviceMark('github')).toMatchObject({ light: 'ink', dark: 'ink' });
    expect(serviceMark('supabase')?.dark).toBe('#3FCF8E');
    expect(hue(serviceMark('supabase')?.light ?? '').h).toBeCloseTo(hue('#3FCF8E').h, 0);
    expect(serviceMark('figma')).toMatchObject({ light: '#F24E1E', dark: '#F24E1E' });
  });
  it('the kit\'s item tile and the pane\'s Card row pick the colour by the scheme', () => {
    const row = readFileSync(join(__dirname, 'v7', 'list-row', 'list-row.css'), 'utf8'), card = readFileSync(join(__dirname, 'v7', 'card', 'card.css'), 'utf8');
    for (const css of [row, card]) expect(css).toMatch(/svg\[data-brand\] \{[^}]*color: light-dark\(var\(--mk-l\), var\(--mk-d\)\);/);
  });
});

describe('publisher tiles', () => {
  it('a skill, plugin or mod whose source proved its publisher shows the publisher\'s mark', () => {
    expect(tileMarkOf({ name: 'PDF files', kind: 'skill', publisher: 'Anthropic', proven: true })).toMatchObject({ of: 'publisher', mark: { id: 'anthropic' } });
    expect(tileMarkOf({ name: 'React best practices', kind: 'skill', publisher: 'Vercel', proven: true })?.mark.id).toBe('vercel');
    expect(brandMarkHTML({ name: 'PDF files', kind: 'plugin', publisher: 'Anthropic', proven: true })).toContain('data-mark-of="publisher"');
  });
  it('a claimed publisher, an unknown one, or a code host keeps the monogram', () => {
    expect(tileMarkOf({ name: 'Anthropic tools', kind: 'skill', publisher: 'Anthropic', proven: false })).toBeNull();
    expect(tileMarkOf({ name: 'Code review', kind: 'skill', publisher: 'Matt Pocock', proven: true })).toBeNull();
    expect(tileMarkOf({ name: 'Tips', kind: 'skill', publisher: 'github.com', proven: true })).toBeNull();
    expect(tileMarkOf({ name: 'Tips', kind: 'skill', publisher: 'GitHub Inc', proven: true })).toBeNull();
  });
  it('a connector shows its service or its monogram, never its publisher\'s mark', () => {
    expect(tileMarkOf({ name: 'Context7', kind: 'connector', collection: 'context7', publisher: 'Upstash', proven: true })).toBeNull();
    expect(tileMarkOf({ name: 'GitHub', kind: 'connector', collection: 'github', publisher: 'GitHub', proven: true })).toMatchObject({ of: 'service' });
  });
});
