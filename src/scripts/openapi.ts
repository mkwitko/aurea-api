import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../app.js';

// Dumps the OpenAPI document to the frontend repo as the Kubb input fixture.
const app = await buildApp();
await app.ready();

const spec = app.swagger();
const out = resolve(process.cwd(), '../web/api.json');
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`OpenAPI written to ${out}`);

await app.close();
process.exit(0);
