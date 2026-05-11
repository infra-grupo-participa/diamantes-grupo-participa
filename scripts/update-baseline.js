#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const baselinePath = join(REPO, '.quality-baseline.json');
const historyPath = join(REPO, '.quality-history.json');
const reportPath = join(REPO, '.quality', 'quality-report.json');

if (!existsSync(reportPath)) {
  console.error('[baseline] sem quality-report.json — rode `npm run quality` primeiro.');
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const LOWER_IS_BETTER = new Set([
  'lint_errors', 'lint_warnings', 'type_errors', 'complexity_max', 'complexity_avg',
  'duplication_percent', 'duplication_clones', 'files_over_500_loc', 'secrets_found',
]);
const HIGHER_IS_BETTER = new Set(['test_coverage']);

let baseline;
if (existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} else {
  baseline = {
    generated_at: report.generated_at,
    tolerance_percent: 5,
    metrics: { ...report.metrics },
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  console.log('[baseline] criada com valores iniciais.');
}

const updated = { ...baseline.metrics };
let changes = 0;
for (const key of Object.keys(report.metrics)) {
  const before = Number(baseline.metrics[key] ?? 0);
  const after = Number(report.metrics[key] ?? 0);
  if (LOWER_IS_BETTER.has(key) && after < before) { updated[key] = after; changes++; }
  else if (HIGHER_IS_BETTER.has(key) && after > before) { updated[key] = after; changes++; }
  else if (!LOWER_IS_BETTER.has(key) && !HIGHER_IS_BETTER.has(key)) { updated[key] = after; }
}

baseline.metrics = updated;
baseline.generated_at = report.generated_at;
writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

let history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : [];
if (!Array.isArray(history)) history = [];
history.push({
  at: report.generated_at,
  metrics: report.metrics,
  commit: process.env.GITHUB_SHA || null,
});
if (history.length > 200) history = history.slice(-200);
writeFileSync(historyPath, JSON.stringify(history, null, 2));

console.log(`[baseline] ${changes} métrica(s) melhoraram → baseline atualizada.`);
console.log(`[baseline] history agora tem ${history.length} snapshot(s).`);
