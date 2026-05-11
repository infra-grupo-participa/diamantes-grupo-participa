#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const cmpPath = join(REPO, '.quality', 'comparison.json');
const reportPath = join(REPO, '.quality', 'quality-report.json');

if (!existsSync(cmpPath) || !existsSync(reportPath)) {
  console.error('[pr-comment] faltando arquivos. Rode quality + compare antes.');
  process.exit(1);
}

const cmp = JSON.parse(readFileSync(cmpPath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const icon = (s) => s === 'fail' ? 'FAIL' : s === 'better' ? 'OK+' : s === 'info' ? 'INFO' : 'OK';
const fmtDelta = (d, p) => {
  if (d === 0) return '-';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d} (${sign}${p}%)`;
};

const banner = cmp.regressions > 0
  ? `### Quality Gate - REPROVADO\n${cmp.regressions} metrica(s) regrediram alem da margem de ${cmp.tolerance}%.`
  : cmp.improvements > 0
    ? `### Quality Gate - APROVADO\n${cmp.improvements} melhora(s) detectada(s).`
    : `### Quality Gate - APROVADO\nSem regressoes. Sem melhorias notaveis.`;

const scopes = cmp.scopes || [];
const scopeRows = scopes.map((s) =>
  `| ${icon(s.status)} | **${s.name}** | ${s.metrics.map((m) => `\`${m}\``).join(', ')} | ${s.objectives.join('<br>')} |`
).join('\n');

const groupedRows = scopes.map((scope) => {
  const rows = cmp.rows
    .filter((r) => r.scope === scope.key)
    .map((r) => `| ${icon(r.status)} | \`${r.key}\` | ${r.criterion || r.key} | ${r.before} | **${r.after}** | ${fmtDelta(r.delta, r.deltaPct)} | ${r.reason || ''} |`)
    .join('\n');
  return `\n#### ${scope.name}\n\n| | Metrica | Criterio | Baseline | Atual | Delta | Nota |\n|---|---|---|---:|---:|---:|---|\n${rows}`;
}).join('\n');

const md = `<!-- quality-gate-comment -->
${banner}

| | Escopo | Metricas | Objetivo |
|---|---|---|---|
${scopeRows}

${groupedRows}

<details><summary>Detalhes do relatorio</summary>

- Gerado em: \`${report.generated_at}\`
- Margem de tolerancia: **${cmp.tolerance}%**
- Tamanho de \`public/\`: ${(report.metrics.bytes_public / 1024).toFixed(1)} KB
- LOC total: ${report.metrics.loc_total}

**Top arquivos por LOC:**
${Object.entries(report.loc_by_file).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `- \`${f}\` - ${n}`).join('\n')}

</details>

> Margem: piorar ate **${cmp.tolerance}%** e tolerado. Acima disso o gate falha. \`type_errors\` e \`secrets_found\` devem permanecer **0** sempre.
`;

mkdirSync(join(REPO, '.quality'), { recursive: true });
writeFileSync(join(REPO, '.quality', 'pr-comment.md'), md);
console.log(md);
