#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const baselinePath = join(REPO, '.quality-baseline.json');
const reportPath = join(REPO, '.quality', 'quality-report.json');

if (!existsSync(baselinePath)) {
  console.error('[compare] .quality-baseline.json nao encontrado. Rode `npm run quality:update-baseline` primeiro.');
  process.exit(2);
}
if (!existsSync(reportPath)) {
  console.error('[compare] .quality/quality-report.json nao encontrado. Rode `npm run quality` primeiro.');
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const tolerance = Number(baseline.tolerance_percent ?? 5);

const HARD_FAIL_ZERO = new Set(['type_errors', 'secrets_found']);
const LOWER_IS_BETTER = new Set([
  'lint_errors', 'lint_warnings', 'type_errors', 'complexity_max', 'complexity_avg',
  'duplication_percent', 'duplication_clones', 'files_over_500_loc', 'secrets_found',
]);
const HIGHER_IS_BETTER = new Set(['test_coverage']);
const INFORMATIONAL = new Set(['loc_total', 'bytes_public']);

const CRITERIA = {
  lint_errors: {
    scope: 'static_analysis',
    scopeName: 'Analise estatica',
    criterion: 'Erros de lint JS',
    objective: 'Bloquear problemas objetivos de JavaScript no front.',
  },
  lint_warnings: {
    scope: 'static_analysis',
    scopeName: 'Analise estatica',
    criterion: 'Warnings de lint JS/TS',
    objective: 'Impedir acumulo de smells e avisos do ESLint/Deno lint.',
  },
  type_errors: {
    scope: 'typing',
    scopeName: 'Tipagem',
    criterion: 'Erros de typecheck Deno',
    objective: 'Manter Edge Functions sem erro de tipo.',
  },
  complexity_max: {
    scope: 'maintainability',
    scopeName: 'Manutenibilidade',
    criterion: 'Complexidade cognitiva maxima',
    objective: 'Evitar funcoes excessivamente dificeis de manter.',
  },
  complexity_avg: {
    scope: 'maintainability',
    scopeName: 'Manutenibilidade',
    criterion: 'Complexidade cognitiva media',
    objective: 'Acompanhar tendencia geral de complexidade.',
  },
  duplication_percent: {
    scope: 'duplication',
    scopeName: 'Duplicacao',
    criterion: 'Percentual duplicado',
    objective: 'Controlar duplicacao relevante de codigo.',
  },
  duplication_clones: {
    scope: 'duplication',
    scopeName: 'Duplicacao',
    criterion: 'Blocos duplicados',
    objective: 'Controlar quantidade de clones detectados.',
  },
  loc_total: {
    scope: 'size',
    scopeName: 'Tamanho',
    criterion: 'LOC total',
    objective: 'Informar crescimento bruto do codigo.',
  },
  files_over_500_loc: {
    scope: 'size',
    scopeName: 'Tamanho',
    criterion: 'Arquivos acima de 500 LOC',
    objective: 'Evitar arquivos grandes demais.',
  },
  secrets_found: {
    scope: 'security',
    scopeName: 'Seguranca',
    criterion: 'Secrets no working tree',
    objective: 'Bloquear vazamento de segredos no codigo vivo.',
  },
  bytes_public: {
    scope: 'bundle',
    scopeName: 'Bundle publico',
    criterion: 'Bytes em public/',
    objective: 'Informar tamanho servido ao usuario.',
  },
  test_coverage: {
    scope: 'tests',
    scopeName: 'Testes',
    criterion: 'Cobertura de testes',
    objective: 'Acompanhar cobertura quando houver suite automatizada.',
  },
};

const rows = [];
let regressions = 0;
let improvements = 0;

for (const key of Object.keys(baseline.metrics)) {
  const before = Number(baseline.metrics[key] ?? 0);
  const after = Number(report.metrics[key] ?? 0);
  const delta = after - before;
  const deltaPct = before === 0 ? (after === 0 ? 0 : 100) : +((delta / Math.max(Math.abs(before), 1)) * 100).toFixed(2);

  let status = 'neutral';
  let reason = '';

  if (HARD_FAIL_ZERO.has(key)) {
    if (after > 0) { status = 'fail'; reason = `${key} deve permanecer 0`; regressions++; }
    else status = 'ok';
  } else if (LOWER_IS_BETTER.has(key)) {
    const tolValue = before + Math.max(before * (tolerance / 100), 0.5);
    if (after > tolValue) { status = 'fail'; reason = `subiu alem da margem de ${tolerance}%`; regressions++; }
    else if (after < before) { status = 'better'; improvements++; }
    else status = 'ok';
  } else if (HIGHER_IS_BETTER.has(key)) {
    const tolValue = before - Math.max(before * (tolerance / 100), 0.5);
    if (after < tolValue) { status = 'fail'; reason = `caiu alem da margem de ${tolerance}%`; regressions++; }
    else if (after > before) { status = 'better'; improvements++; }
    else status = 'ok';
  } else if (INFORMATIONAL.has(key)) {
    status = 'info';
  }

  const meta = CRITERIA[key] || {
    scope: 'other',
    scopeName: 'Outros',
    criterion: key,
    objective: 'Metrica sem escopo definido.',
  };

  rows.push({ key, ...meta, before, after, delta, deltaPct, status, reason });
}

const scopeOrder = [...new Set(rows.map((r) => r.scope))];
const scopes = scopeOrder.map((scope) => {
  const scopeRows = rows.filter((r) => r.scope === scope);
  return {
    key: scope,
    name: scopeRows[0]?.scopeName || scope,
    objectives: [...new Set(scopeRows.map((r) => r.objective))],
    metrics: scopeRows.map((r) => r.key),
    regressions: scopeRows.filter((r) => r.status === 'fail').length,
    improvements: scopeRows.filter((r) => r.status === 'better').length,
    status: scopeRows.some((r) => r.status === 'fail')
      ? 'fail'
      : scopeRows.some((r) => r.status === 'better')
        ? 'better'
        : scopeRows.every((r) => r.status === 'info')
          ? 'info'
          : 'ok',
  };
});

console.log('\n=== Quality Gate - comparacao contra baseline ===');
console.log(`Tolerancia: ${tolerance}%`);
console.log('');
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('Escopo', 20), pad('Metrica', 24), pad('Baseline', 12), pad('Atual', 12), pad('Delta', 10), pad('Delta%', 10), 'Status');
console.log('-'.repeat(106));
for (const r of rows) {
  const tag = r.status === 'fail' ? 'PIOROU' : r.status === 'better' ? 'MELHOROU' : r.status === 'info' ? 'info' : 'ok';
  console.log(
    pad(r.scopeName, 20),
    pad(r.key, 24),
    pad(r.before, 12),
    pad(r.after, 12),
    pad((r.delta >= 0 ? '+' : '') + r.delta, 10),
    pad((r.deltaPct >= 0 ? '+' : '') + r.deltaPct + '%', 10),
    tag,
    r.reason ? `(${r.reason})` : ''
  );
}
console.log('');
console.log(`Resumo: ${improvements} melhoras, ${regressions} regressoes`);

mkdirSync(join(REPO, '.quality'), { recursive: true });
writeFileSync(join(REPO, '.quality', 'comparison.json'), JSON.stringify({
  tolerance, scopes, rows, regressions, improvements,
  baseline_generated_at: baseline.generated_at,
  report_generated_at: report.generated_at,
}, null, 2));

if (regressions > 0) {
  console.error(`\nQuality gate falhou: ${regressions} metrica(s) regrediram alem da margem.`);
  process.exit(1);
}
console.log('\nQuality gate aprovado.');
