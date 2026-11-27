// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { html } from './html';
import { logoHTML } from './logo';

describe('the logo', () => {
  it('is static wherever it labels: still, and no animation attribute', () => {
    for (const s of [logoHTML(), logoHTML({ mark: true }), logoHTML({ mark: true, label: false })]) {
      expect(s).toContain(' still');
      expect(s).not.toMatch(/letters|animation|look|loop/);
    }
    expect(logoHTML({ mark: true })).toContain('<boopis-logo mark still');
    expect(logoHTML({ label: false })).toContain('aria-hidden="true"');
  });

  it('keeps a label out of markup breaking characters', () => {
    expect(logoHTML({ label: 'a"><script>' })).not.toContain('<script>');
  });

  it('draws an empty state with the static mark and never the phi', () => {
    const s = html.empty({ title: 'Nothing here', mark: true });
    expect(s).toContain('<boopis-logo mark still aria-hidden="true">');
    expect(s).not.toContain('<svg');
  });
});
