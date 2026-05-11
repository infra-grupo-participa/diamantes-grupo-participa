#!/usr/bin/env node
// Quality check do diamantes-grupo-participa.
// Adaptação do gate do sip-system para stack HTML/JS/PHP sem bundler.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const REPO = process.cwd();
const OUT_DIR = join(REPO, '.quality');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const log = (msg) => process.stdout.write(`[quality] ${msg}\n`);

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
}

function safeJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// Diretórios/arquivos que NÃO contam pro gate (gerados, migrations, etc).
const IGNORE_GLOB = [
  '/node_modules/', '/.git/', '/.quality/',
  '/db/migrations/',
];

function walk(dir, filterFn) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.quality') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, filterFn));
    else if (filterFn(p)) out.push(p);
  }
  return out;
}

const allCodeFiles = walk(REPO, (p) => {
  const norm = p.replace(/\\/g, '/');
  if (IGNORE_GLOB.some((g) => norm.includes(g))) return false;
  const ext = extname(p);
  return ['.js', '.html', '.css', '.php'].includes(ext);
});

log(`Encontrados ${allCodeFiles.length} arquivos de código`);

const locByFile = {};
let locTotal = 0;
let filesOver500 = 0;
for (const f of allCodeFiles) {
  const content = readFileSync(f, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('//')).length;
  const rel = relative(REPO, f).replace(/\\/g, '/');
  locByFile[rel] = lines;
  locTotal += lines;
  if (lines > 500) filesOver500++;
}

log(`LOC total: ${locTotal} | arquivos >500 LOC: ${filesOver500}`);

// ESLint nos JS — escopo: assets/js + admin/assets + auth-guard.js
log('Rodando ESLint...');
const lintTargets = [
  'assets/js',
  'admin/assets',
  'auth-guard.js',
].filter((p) => existsSync(join(REPO, p)));
const lintFront = run(`npx eslint ${lintTargets.join(' ')} --ext .js -f json`, { cwd: REPO });
const lintResults = safeJSON(lintFront.stdout, []);
let lintErrors = 0;
let lintWarnings = 0;
for (const r of lintResults) {
  lintErrors += r.errorCount || 0;
  lintWarnings += r.warningCount || 0;
  for (const m of r.messages || []) {
    if (m.severity >= 1) {
      const file = (r.filePath || '').replace(/.*[\\/]diamantes-grupo-participa[\\/]/, '');
      log(`[eslint-${m.severity === 2 ? 'error' : 'warn'}] ${file}:${m.line} [${m.ruleId}] ${m.message}`);
    }
  }
}

let complexityMax = 0;
let complexitySum = 0;
let complexityCount = 0;
for (const r of lintResults) {
  for (const m of r.messages || []) {
    if (m.ruleId === 'sonarjs/cognitive-complexity') {
      const n = Number((m.message.match(/(\d+)/) || [])[1] || 0);
      if (n > complexityMax) complexityMax = n;
      complexitySum += n;
      complexityCount++;
    }
  }
}

// jscpd — duplicação
log('Rodando jscpd (duplicação)...');
run('npx jscpd', { cwd: REPO });
let dupPercent = 0;
let dupClones = 0;
const jscpdReport = join(OUT_DIR, 'jscpd', 'jscpd-report.json');
if (existsSync(jscpdReport)) {
  const data = safeJSON(readFileSync(jscpdReport, 'utf8'), {});
  dupPercent = Number(data?.statistics?.total?.percentage || 0);
  dupClones = Number(data?.statistics?.total?.clones || 0);
}

// gitleaks — secrets
log('Rodando gitleaks (secrets, sem histórico)...');
let secretsFound = 0;
const gitleaksOut = join(OUT_DIR, 'gitleaks-report.json');
if (existsSync(gitleaksOut)) unlinkSync(gitleaksOut);
const gitleaksCfg = existsSync(join(REPO, '.gitleaks.toml')) ? '--config .gitleaks.toml' : '';
const gitleaks = run(`gitleaks detect --source . --no-git ${gitleaksCfg} --report-path ${gitleaksOut} --report-format json --no-banner`, { cwd: REPO });
if (existsSync(gitleaksOut)) {
  const data = safeJSON(readFileSync(gitleaksOut, 'utf8'), []);
  secretsFound = Array.isArray(data) ? data.length : 0;
}
if (gitleaks.status !== 0 && gitleaks.status !== 1 && !existsSync(gitleaksOut)) {
  log('aviso: gitleaks não disponível, pulando');
}

// Tamanho do bundle público — somatório de JS/CSS/HTML em raiz + admin/ + portal/ + assets/
let bytesPublic = 0;
for (const f of allCodeFiles) {
  const norm = f.replace(/\\/g, '/');
  if (norm.includes('/admin/') || norm.includes('/assets/') || norm.endsWith('/index.html')) {
    bytesPublic += statSync(f).size;
  }
}

const report = {
  generated_at: new Date().toISOString(),
  metrics: {
    lint_errors: lintErrors,
    lint_warnings: lintWarnings,
    type_errors: 0,           // sem TS — sempre 0
    complexity_max: complexityMax,
    complexity_avg: complexityCount ? +(complexitySum / complexityCount).toFixed(2) : 0,
    duplication_percent: +dupPercent.toFixed(2),
    duplication_clones: dupClones,
    loc_total: locTotal,
    files_over_500_loc: filesOver500,
    secrets_found: secretsFound,
    bytes_public: bytesPublic,
    test_coverage: 0,
  },
  loc_by_file: locByFile,
};

writeFileSync(join(OUT_DIR, 'quality-report.json'), JSON.stringify(report, null, 2));
log('Relatório salvo em .quality/quality-report.json');

const html = renderHTML(report);
writeFileSync(join(OUT_DIR, 'quality-report.html'), html);
log('HTML salvo em .quality/quality-report.html');

console.table(report.metrics);

function renderHTML(r) {
  const m = r.metrics;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Quality Report - Diamantes Grupo Participa</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1040px;margin:32px auto;padding:0 20px;color:#222}
h1{margin:0 0 4px;font-size:24px}
.sub{color:#666;font-size:13px;margin-bottom:24px}
table{border-collapse:collapse;width:100%;margin:16px 0}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee}
th{background:#f7f7f8;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
code{background:#f3f4f6;border-radius:4px;padding:2px 5px}
</style></head><body>
<h1>Diamantes Grupo Participa — Quality Report</h1>
<div class="sub">Gerado em ${r.generated_at}</div>
<table>
<tr><th>Métrica</th><th>Valor</th></tr>
<tr><td>lint_errors</td><td>${m.lint_errors}</td></tr>
<tr><td>lint_warnings</td><td>${m.lint_warnings}</td></tr>
<tr><td>complexity_max</td><td>${m.complexity_max}</td></tr>
<tr><td>complexity_avg</td><td>${m.complexity_avg}</td></tr>
<tr><td>duplication_percent</td><td>${m.duplication_percent}%</td></tr>
<tr><td>duplication_clones</td><td>${m.duplication_clones}</td></tr>
<tr><td>loc_total</td><td>${m.loc_total}</td></tr>
<tr><td>files_over_500_loc</td><td>${m.files_over_500_loc}</td></tr>
<tr><td>secrets_found</td><td>${m.secrets_found}</td></tr>
<tr><td>bytes_public</td><td>${m.bytes_public.toLocaleString('pt-BR')}</td></tr>
</table>
<h2>LOC por arquivo (top 30)</h2>
<table><thead><tr><th>Arquivo</th><th>Linhas</th></tr></thead><tbody>
${Object.entries(r.loc_by_file).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([f,n])=>`<tr><td><code>${f}</code></td><td>${n}</td></tr>`).join('')}
</tbody></table>
</body></html>`;
}
