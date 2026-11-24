// @vitest-environment node
/* The vendored <orb-avatar> is orb3 at its pinned commit, byte for byte (ADR-0051): every file vendor/orb-avatar.VENDOR.json lists has
   the sha256 recorded there. CI re-fetches the commit and compares every byte (scripts/vendor-orb.sh --check); this is the offline half. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const VENDOR = join(__dirname, '..', '..', 'vendor');
const record = JSON.parse(readFileSync(join(VENDOR, 'orb-avatar.VENDOR.json'), 'utf8')) as { sha: string; version: string; files: Record<string, { from: string; sha256: string }> };

describe('the vendored orb', () => {
  it('is orb3 3.0.2 at bfa4e8c (ORBS.md section 23)', () => {
    expect(record.version).toBe('3.0.2');
    expect(record.sha.startsWith('bfa4e8c')).toBe(true);
  });
  for (const [name, f] of Object.entries(record.files)) it(name + ' is the recorded bytes', () => {
    expect(createHash('sha256').update(readFileSync(join(VENDOR, name))).digest('hex')).toBe(f.sha256);
  });
});
