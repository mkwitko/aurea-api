// Copies non-TypeScript assets from src/ into dist/, preserving layout.
//
// `tsc` only emits .js for .ts inputs, so runtime assets read from disk are
// silently missing in dist/. That bit the error catalog: the i18n bundles are
// loaded with readFileSync from `import.meta.dirname/i18n/<locale>.json`, so a
// dist-only build degraded every API error message to its raw code
// (e.g. "AUR-T0008" instead of the translated text) while dev — which runs tsx
// straight off src/ — looked fine.
//
// This copies whatever is not a .ts file rather than an explicit i18n list, so
// any asset added under src/ later is carried over without repeating the bug.
import { cp, readdir, mkdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';

const SRC = 'src';
const DIST = 'dist';

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (!entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const assets = await collect(SRC);

for (const file of assets) {
  const target = join(DIST, relative(SRC, file));
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
}

console.log(`copy-assets: ${assets.length} file(s) copied to ${DIST}/`);
