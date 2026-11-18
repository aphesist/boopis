#!/usr/bin/env node
/* Copy Hermes's generated gateway contract types (MIT) into src/vendor/hermes-shared, byte for byte, and pin them.

     node scripts/vendor-hermes-shared.mjs <hermes-agent checkout> [--tag vX.Y.Z]   copy, then rewrite PIN.json
     node scripts/vendor-hermes-shared.mjs <hermes-agent checkout> --check          compare the copy with the checkout

   The copy is never edited here: changes are made upstream and re-vendored. After a bump, read `git diff` on the file:
   a renamed or removed method or event is a contract change the host and the live provider must follow. */
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '../src/vendor/hermes-shared');
const args = process.argv.slice(2);
const check = args.includes('--check');
const tagAt = args.indexOf('--tag');
const checkout = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--tag');
if (!checkout) { console.error('usage: vendor-hermes-shared.mjs <hermes-agent checkout> [--check | --tag vX.Y.Z]'); process.exit(2); }

const pinPath = join(dest, 'PIN.json');
const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let bad = 0;
for (const [name, meta] of Object.entries(pin.files)) {
  const from = join(checkout, meta.from);
  const to = join(dest, name);
  if (check) {
    const ok = sha(from) === sha(to) && sha(to) === meta.sha256;
    if (!ok) { console.error(`${name}: differs from ${from} (or from its pin)`); bad++; }
  } else {
    copyFileSync(from, to);
    meta.sha256 = sha(to);
  }
}
if (!check) {
  if (tagAt >= 0) pin.tag = args[tagAt + 1];
  writeFileSync(pinPath, JSON.stringify(pin, null, 2) + '\n');
  console.log('vendored ' + Object.keys(pin.files).join(', ') + ' at ' + pin.tag);
}
process.exit(bad ? 1 : 0);
