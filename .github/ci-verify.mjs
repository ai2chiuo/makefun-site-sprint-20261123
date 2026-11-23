import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const kit=path.resolve(process.argv[2]);
const source=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(kit,'kit.json'),'utf8'));
for(const file of manifest.files){
 const resolved=path.resolve(kit,file.path);
 assert(resolved.startsWith(kit+path.sep),'Manifest path is outside kit');
 const bytes=fs.readFileSync(resolved);
 assert.equal(bytes.length,file.size);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
}
const cases=JSON.parse(fs.readFileSync(path.join(kit,'practice/input/cases.json'),'utf8'));
const expected=JSON.parse(fs.readFileSync(path.join(kit,'practice/reference/expected.json'),'utf8')).cases.map(c=>c.output);
const {run}=await import(pathToFileURL(path.join(source,'solve.js')).href);
for(let i=0;i<cases.length;i++)assert.deepStrictEqual(run(structuredClone(cases[i].input)),expected[i],`Practice case ${cases[i].id}`);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'site-sprint-ci-'));
const hashes=[];
for(let i=0;i<2;i++){
 const output=path.join(temp,String(i));
 const proc=spawnSync(process.execPath,[path.join(source,'main.ts')],{cwd:source,env:{...process.env,MAKEFUN_INPUT_DIR:path.join(kit,'practice/input'),MAKEFUN_OUTPUT_DIR:output},encoding:'utf8',timeout:10000});
 assert.equal(proc.status,0,proc.stderr);
 const file=path.join(output,'answers.json');
 const bytes=fs.readFileSync(file);
 assert.deepStrictEqual(JSON.parse(bytes),expected,'Actual driver answers');
 assert.equal(fs.statSync(file).mode&0o004,0o004,'Outputs must be world-readable');
 hashes.push(crypto.createHash('sha256').update(bytes).digest('hex'));
}
assert.equal(hashes[0],hashes[1],'Two real runs must be byte-identical');
console.log(JSON.stringify({node:process.version,platform:process.platform,kit_files_verified:manifest.files.length,practice_cases:cases.length,driver_runs:2,output_sha256:hashes[0],passed:true}));
