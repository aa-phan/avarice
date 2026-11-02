#!/usr/bin/env node
// check-results.mjs RESULTS.json: validates spike completeness and the spend cap. Exit 1 on any violation.
//   - all seven keys S0-A..S0-G exist with a valid verdict
//   - every non-skipped spike lists at least one evidence path that exists (relative paths resolve against RESULTS.json's directory)
//   - authorization is recorded, per-spike costs plus precondition sum to totalCostUsd, and totalCostUsd is at or below the authorized cap
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: check-results.mjs RESULTS.json'); process.exit(2); }
const dir = path.dirname(path.resolve(file));
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const VERDICTS = new Set(['pass', 'fail', 'finding', 'skipped-declined']);
const KEYS = ['S0-A', 'S0-B', 'S0-C', 'S0-D', 'S0-E', 'S0-F', 'S0-G'];
const errors = [];

if (!r.authorization || typeof r.authorization.capUsd !== 'number' || !r.authorization.option) errors.push('missing authorization (option and capUsd)');
for (const k of ['hostVersion', 'gsdVersion', 'graphifyVersion']) if (!r[k]) errors.push(`missing ${k}`);
let sum = typeof r.preconditionCostUsd === "number" ? r.preconditionCostUsd : 0;   // launch-line precondition and env-bisect runs
for (const k of KEYS) {
  const s = r.spikes?.[k];
  if (!s) { errors.push(`missing spike key ${k}`); continue; }
  if (!VERDICTS.has(s.verdict)) errors.push(`${k}: invalid verdict ${JSON.stringify(s.verdict)}`);
  if (typeof s.costUsd !== 'number') errors.push(`${k}: costUsd must be a number`); else sum += s.costUsd;
  if (s.verdict === 'skipped-declined') continue;
  if (!Array.isArray(s.cases) || s.cases.length === 0) errors.push(`${k}: no cases recorded`);
  if (typeof s.recommendation !== 'string' || !s.recommendation) errors.push(`${k}: missing recommendation`);
  if (!Array.isArray(s.evidence) || s.evidence.length === 0) { errors.push(`${k}: no evidence paths`); continue; }
  for (const e of s.evidence) {
    const p = path.isAbsolute(e) ? e : path.join(dir, e);
    if (!fs.existsSync(p)) errors.push(`${k}: missing evidence file ${e}`);
  }
}
if (typeof r.totalCostUsd !== 'number') errors.push('missing totalCostUsd');
else {
  if (Math.abs(sum - r.totalCostUsd) > 0.0005) errors.push(`spike costs plus precondition sum to ${sum.toFixed(4)} but totalCostUsd is ${r.totalCostUsd}`);
  if (r.authorization && r.totalCostUsd > r.authorization.capUsd) errors.push(`totalCostUsd ${r.totalCostUsd} exceeds authorized cap ${r.authorization.capUsd}`);
}
if (errors.length) { for (const e of errors) console.error(`FAIL: ${e}`); process.exit(1); }
console.log(`OK: ${KEYS.length} spikes, total ${r.totalCostUsd} USD within cap ${r.authorization.capUsd} USD`);
