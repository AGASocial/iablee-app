#!/usr/bin/env node
/**
 * Compare two baseline folders side-by-side.
 * Usage: node plan/load-tests/compare-baselines.mjs <older> <newer>
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error('Usage: node compare-baselines.mjs <baseline-a> <baseline-b>');
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function p95(summary) {
  const m = summary?.metrics?.http_req_duration?.values ?? summary?.metrics?.http_req_duration;
  if (!m) return null;
  return m['p(95)'] ?? m.avg ?? null;
}

function failRate(summary) {
  const m = summary?.metrics?.http_req_failed?.values ?? summary?.metrics?.http_req_failed;
  if (!m) return null;
  return m.rate ?? null;
}

function loadSummaries(dir) {
  const map = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.summary.json')) continue;
    map.set(f.replace('.summary.json', ''), readJson(join(dir, f)));
  }
  return map;
}

const a = loadSummaries(dirA);
const b = loadSummaries(dirB);
const scripts = [...new Set([...a.keys(), ...b.keys()])].sort();

const manifestA = existsSync(join(dirA, 'manifest.json')) ? readJson(join(dirA, 'manifest.json')) : {};
const manifestB = existsSync(join(dirB, 'manifest.json')) ? readJson(join(dirB, 'manifest.json')) : {};

console.log(`\nBaseline comparison`);
console.log(`  A: ${manifestA.target ?? '?'} / ${manifestA.runId ?? basename(dirA)} (${manifestA.recordedAt ?? '?'})`);
console.log(`      ${manifestA.baseUrl ?? ''}`);
console.log(`  B: ${manifestB.target ?? '?'} / ${manifestB.runId ?? basename(dirB)} (${manifestB.recordedAt ?? '?'})`);
console.log(`      ${manifestB.baseUrl ?? ''}\n`);
console.log('Script                  | p95 A      | p95 B      | Δ p95    | err A  | err B');
console.log('------------------------|------------|------------|----------|--------|------');

for (const script of scripts) {
  const p95a = p95(a.get(script));
  const p95b = p95(b.get(script));
  const delta =
    p95a != null && p95b != null ? `${p95b - p95a >= 0 ? '+' : ''}${Math.round(p95b - p95a)} ms` : '—';
  const fa = failRate(a.get(script));
  const fb = failRate(b.get(script));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `${pad(script, 23)} | ${pad(p95a != null ? `${Math.round(p95a)} ms` : '—', 10)} | ${pad(p95b != null ? `${Math.round(p95b)} ms` : '—', 10)} | ${pad(delta, 8)} | ${pad(fa != null ? `${(fa * 100).toFixed(1)}%` : '—', 6)} | ${fb != null ? `${(fb * 100).toFixed(1)}%` : '—'}`
  );
}

console.log('');
