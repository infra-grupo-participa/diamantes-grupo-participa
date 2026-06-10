/**
 * interactive-handlers.test.js — garante que todo onclick="fn(" inline aponta p/ função
 * definida na mesma página. Botão com handler inexistente = elemento interativo quebrado.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PAGES = [
  'portal/dashboard.html', 'portal/demandas.html', 'portal/projetos.html', 'portal/novo-projeto.html',
  'portal/briefing.html', 'portal/briefing-basico.html', 'portal/perfil.html',
  'admin/projetos.html', 'admin/alunos-diamantes.html', 'admin/index.html', 'admin/assinaturas.html',
];

function readPage(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function orphanHandlers(html) {
  const names = [...new Set([...html.matchAll(/onclick="([a-zA-Z_$][\w$]*)\s*\(/g)].map(m => m[1]))];
  const defined = (n) => new RegExp(
    'function\\s+' + n + '\\b|\\b' + n + '\\s*=\\s*(async\\s*)?(function|\\()|window\\.' + n + '\\s*='
  ).test(html);
  return names.filter(n => !defined(n));
}

describe('handlers interativos (onclick) apontam p/ função definida', () => {
  for (const page of PAGES) {
    test(page, () => {
      const html = readPage(page);
      expect(html, `página ausente: ${page}`).toBeTruthy();
      expect(orphanHandlers(html)).toEqual([]);
    });
  }
});
