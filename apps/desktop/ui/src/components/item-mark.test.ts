/* Item marks: the service a connector connects to, found only from evidence in the data (its collection id, its address's host,
   the package or image it runs, a store item's home page), a publisher's mark by the publisher's exact name, and a monogram for
   everything else, the same letters every time. */
import { describe, expect, it } from 'vitest';
import collection from '../../../../shared/data/connectors.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemMarkHTML, monogram, packageOf, publisherHTML, publisherMarkOf, serviceMark, serviceMarkOf, serviceMarks, tileMarkOf } from './item-mark';
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
  it('the collection\'s entries each get the mark the map gives, or none (Context7, Playwright, Firecrawl, Exa and the reference servers have none)', () => {
    const got = Object.fromEntries((collection as unknown as { connectors: { id: string; name: string }[] }).connectors.map((c) => [c.id, id(serviceMarkOf({ name: c.name, collection: c.id }))]));
    expect(got).toEqual({
      context7: null, 'chrome-devtools': 'googlechrome', playwright: null, github: 'github', firecrawl: null, exa: null, notion: 'notion', supabase: 'supabase',
      'brave-search': 'brave', atlassian: 'atlassian', mongodb: 'mongodb', sentry: 'sentry', neon: 'neon', 'sequential-thinking': null, memory: null
    });
  });
  it('an installed connector by what it runs: its address, its package or its image', () => {
    expect(id(serviceMarkOf({ name: 'mine', url: 'https://mcp.notion.com/mcp' }))).toBe('notion');
    expect(id(serviceMarkOf({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/' }))).toBe('github');
    expect(id(serviceMarkOf({ name: 'x', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server@2.2.0'] }))).toBe('brave');
    expect(id(serviceMarkOf({ name: 'x', command: 'npx', args: ['-y', 'mongodb-mcp-server@3.3.0', '--readOnly'] }))).toBe('mongodb');
    expect(id(serviceMarkOf({ name: 'x', command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server@sha256:040c4e'] }))).toBe('github');
  });
  it('what it runs outranks its name: a server called github that runs something else is not GitHub', () => {
    expect(serviceMarkOf({ name: 'github', collection: 'github', command: 'npx', args: ['-y', 'notes-mcp@1.2.3'] })).toBeNull();
    expect(serviceMarkOf({ name: 'notion', collection: 'notion', url: 'https://mcp.example.com/mcp' })).toBeNull();
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

describe('the tile', () => {
  it('draws the service\'s mark in currentColor, hidden from assistive tech (its name sits beside it)', () => {
    const h = itemMarkHTML({ name: 'GitHub', collection: 'github' });
    expect(h).toContain('data-mark="github"');
    expect(h).toContain('fill="currentColor"');
    expect(h).toContain('data-brand style="--mk-l:#181717;--mk-d:#FFFFFF"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).toContain('data-sq');
    expect(h).toContain('data-size="24"');
  });
  it('draws a monogram for anything else, at 40 on an item\'s page', () => {
    const h = itemMarkHTML({ name: 'Release notes', kind: 'skill' }, { size: 40 });
    expect(h).toContain('ui-imark--mono');
    expect(h).toContain('>RN<');
    expect(h).toContain('data-size="40"');
    expect(h).not.toContain('<svg');
  });
  it('escapes the letters it draws', () => {
    expect(itemMarkHTML({ name: '<b>' }, {})).not.toContain('<b>');
  });
  it('a publisher with a mark leads with it; one without is its name alone', () => {
    expect(publisherHTML('Anthropic')).toContain('data-mark="anthropic"');
    expect(publisherHTML('Matt Pocock')).not.toContain('<svg');
    expect(publisherHTML('Matt Pocock')).toContain('Matt Pocock');
    expect(serviceMark('github')?.name).toBe('GitHub');
  });
});

describe('brand colours (owner decision, 23 November 2026)', () => {
  /* the raised tile (--bg-3) of every preset, read from tokens.css, and its scheme as theme.ts decides it (the ground's luminance) */
  const css = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');
  const presets = ['catalog', 'graphite', 'bone', 'typewriter'].map((id) => {
    const block = new RegExp('\\[data-hx-preset="' + id + '"\\][^{]*\\{([^}]*)\\}').exec(css)?.[1] ?? '';
    const tok = (n: string): string => new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})').exec(block)?.[1] ?? '';
    return { id, tile: tok('bg-3'), light: lum(tok('bg-2')) > 0.4 };
  });
  it('reads a tile for every preset, and Bone is the light one', () => {
    for (const p of presets) expect(p.tile, p.id).toMatch(/^#[0-9a-f]{6}$/i);
    expect(presets.filter((p) => p.light).map((p) => p.id)).toEqual(['bone']);
  });
  it('every mark holds 3:1 against the tile of every preset, in the colour its scheme draws (WCAG 1.4.11)', () => {
    for (const m of serviceMarks()) for (const p of presets) {
      const c = p.light ? m.light : m.dark;
      expect(ratio(c, p.tile), `${m.id} on ${p.id} (${c} on ${p.tile})`).toBeGreaterThanOrEqual(3);
    }
  });
  it('each colour is the brand\'s own (Simple Icons\' hex) or its one-colour black or white version, with the reason written down', () => {
    for (const e of (mapFile as unknown as { marks: { id: string; hex: string; color: { light: string; dark: string; why: string } }[] }).marks) {
      for (const c of [e.color.light, e.color.dark]) expect(['#' + e.hex.toUpperCase(), '#000000', '#FFFFFF', '#181717', '#191919'], e.id).toContain(c.toUpperCase());
      expect(e.color.why.length, e.id).toBeGreaterThan(20);
    }
  });
  it('a dark brand on the dark tiles takes its white version (GitHub on Graphite), a pale one on the light tile its black', () => {
    expect(serviceMark('github')).toMatchObject({ light: '#181717', dark: '#FFFFFF' });
    expect(serviceMark('supabase')).toMatchObject({ light: '#000000', dark: '#3FCF8E' });
    expect(serviceMark('brave')).toMatchObject({ light: '#FB542B', dark: '#FB542B' });
  });
  it('the stylesheet picks the colour by the scheme', () => {
    const kit = readFileSync(join(__dirname, 'components.css'), 'utf8');
    expect(kit).toMatch(/:is\(\.ui-imark__svg, \.ui-pub__mark\)\[data-brand\] \{ color: light-dark\(var\(--mk-l\), var\(--mk-d\)\); \}/);
  });
});

describe('publisher tiles', () => {
  it('a skill, plugin or mod whose source proved its publisher shows the publisher\'s mark', () => {
    expect(tileMarkOf({ name: 'PDF files', kind: 'skill', publisher: 'Anthropic', proven: true })).toMatchObject({ of: 'publisher', mark: { id: 'anthropic' } });
    expect(tileMarkOf({ name: 'React best practices', kind: 'skill', publisher: 'Vercel', proven: true })?.mark.id).toBe('vercel');
    expect(itemMarkHTML({ name: 'PDF files', kind: 'plugin', publisher: 'Anthropic', proven: true })).toContain('data-mark-of="publisher"');
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
  it('the publisher\'s name drops its mark when the source did not prove it', () => {
    expect(publisherHTML('Anthropic', { proven: false })).not.toContain('<svg');
    expect(publisherHTML('Anthropic', { proven: true })).toContain('data-brand');
  });
});
