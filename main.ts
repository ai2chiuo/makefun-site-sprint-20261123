import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as { input: unknown }[];

// Encode one result at a time so output trees can be collected between cases.
const chunks = [Buffer.from('[')];
const separator = Buffer.from(',');
for (const { input } of cases) {
  if (chunks.length > 1) chunks.push(separator);
  chunks.push(Buffer.from(JSON.stringify(run(input))));
}
chunks.push(Buffer.from(']'));

mkdirSync(outputDir, { recursive: true, mode: 0o755 });
const file = join(outputDir, 'answers.json');
writeFileSync(file, Buffer.concat(chunks), { mode: 0o644 });
if (process.platform !== 'win32') chmodSync(file, 0o644);
