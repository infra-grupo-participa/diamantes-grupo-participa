#!/usr/bin/env node
// Deploy FTP local (estilo sip/ftp-deploy.mjs), adaptado para o diamantes.
//
// Diferenças do sip:
//  - O site do diamantes é a RAIZ do repo (não há pasta public/). Para um deploy
//    seguro, sobe APENAS os diretórios passados (default: portal/) — SEM deletar e
//    SEM tocar no .htaccess de produção (que é gerado com secrets pelo CI).
//  - O usuário FTP da Hostinger entra DENTRO de public_html → auto-detecta a raiz.
//
// Uso:
//   npm run deploy:ftp            # sobe portal/ (lê .env: FTP_HOST/USER/PASS)
//   npm run deploy:ftp:dry        # mostra o plano, não envia
//   node scripts/ftp-deploy.mjs --dir portal --dir api/clickup.php  # alvos custom
//
// .env (na raiz):
//   FTP_HOST=...            (default 147.93.34.90)
//   FTP_USER=...            (obrigatório — ver secret HOSTINGER_FTP_USER)
//   FTP_PASS=...            (obrigatório — ver secret HOSTINGER_FTP_PASSWORD)
//   FTP_REMOTE_ROOT=...     (opcional; vazio = auto-detect public_html)

import { Client } from "basic-ftp";
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, posix, relative, resolve } from "node:path";

function loadDotEnv(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(resolve(process.cwd(), ".env"));

const HOST = process.env.FTP_HOST || "147.93.34.90";
const USER = process.env.FTP_USER;
const PASS = process.env.FTP_PASS;
const DRY  = process.argv.includes("--dry-run");

// Diretórios/arquivos a subir (default: portal/). Sempre relativos à raiz do repo.
const dirArgs = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--dir" && process.argv[i + 1]) dirArgs.push(process.argv[i + 1]);
}
const TARGETS = dirArgs.length ? dirArgs : ["portal"];

// Nunca subir estes (segurança): .htaccess de prod é gerado com secrets; storage é runtime.
const SKIP = [
  ".htaccess",
  "api/storage/",
  "api/data/clickup-api-key.txt",
];
const FORCE_EXT = new Set([".html", ".js", ".css"]); // sempre reenvia (cache-bust por hash não muda tamanho)

if (!USER || !PASS) {
  console.error("ERRO: defina FTP_USER e FTP_PASS no .env (ou no ambiente).");
  console.error("      São os mesmos valores dos secrets HOSTINGER_FTP_USER / HOSTINGER_FTP_PASSWORD.");
  process.exit(2);
}

function skip(rel) { return SKIP.some((s) => rel === s || rel.startsWith(s)); }

async function walkLocal(targets) {
  const files = new Map();
  async function rec(abs, root) {
    let entries;
    try { entries = await readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(abs, e.name);
      const rel = relative(process.cwd(), p).replaceAll("\\", "/");
      if (skip(rel)) continue;
      if (e.isDirectory()) await rec(p, root);
      else if (e.isFile()) { const st = await stat(p); files.set(rel, { size: st.size, abs: p }); }
    }
  }
  for (const t of targets) {
    const abs = resolve(process.cwd(), t);
    const st = await stat(abs).catch(() => null);
    if (!st) { console.warn(`! alvo inexistente: ${t}`); continue; }
    if (st.isDirectory()) await rec(abs, t);
    else { const rel = t.replaceAll("\\", "/"); if (!skip(rel)) files.set(rel, { size: st.size, abs }); }
  }
  return files;
}

async function detectRoot(client) {
  if (process.env.FTP_REMOTE_ROOT != null && process.env.FTP_REMOTE_ROOT !== "") return process.env.FTP_REMOTE_ROOT;
  try {
    const list = await client.list("/");
    if (list.some((it) => it.name === "public_html" && it.isDirectory)) return "/public_html";
  } catch { /* ignore */ }
  return ""; // login já cai dentro de public_html
}

(async () => {
  const client = new Client(60_000);
  client.ftp.verbose = false;
  const t0 = Date.now();
  try {
    console.log(`> conectando ftp://${USER}@${HOST}`);
    await client.access({ host: HOST, user: USER, password: PASS, secure: false });
    const root = await detectRoot(client);
    console.log(`> conectado. raiz remota: '${root || "(login dir = public_html)"}'`);

    const local = await walkLocal(TARGETS);
    console.log(`> ${local.size} arquivo(s) locais em [${TARGETS.join(", ")}]`);

    // diff por tamanho; .html/.js/.css sempre reenviados
    const toUpload = [];
    for (const [rel, info] of local) {
      const remotePath = posix.join(root || ".", rel);
      let rsize = -1;
      try { rsize = await client.size(remotePath); } catch { rsize = -1; }
      const forced = FORCE_EXT.has(rel.slice(rel.lastIndexOf(".")).toLowerCase());
      if (rsize < 0 || rsize !== info.size || forced) toUpload.push(rel);
    }

    console.log(`\nPlano: upload ${toUpload.length} arquivo(s) (sem delete)`);
    for (const f of toUpload) console.log(`  + ${f}`);

    if (DRY) { console.log(`\n[dry-run] nada enviado.`); return; }

    let up = 0;
    for (const rel of toUpload) {
      const info = local.get(rel);
      const remotePath = posix.join(root || ".", rel);
      try {
        await client.ensureDir(posix.dirname(remotePath));
        await client.cd("/");
        await client.uploadFrom(info.abs, remotePath);
        up++;
        console.log(`  ✓ ${rel}`);
      } catch (e) {
        console.error(`  ! falha ${rel}: ${e.message}`);
      }
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✓ deploy concluído em ${dt}s — enviados ${up}/${toUpload.length}`);
    console.log(`  Lembrete: purgar cache LiteSpeed no hPanel se algo ficar "preso".`);
  } finally {
    client.close();
  }
})().catch((err) => { console.error(`\n!! ${err.stack || err.message}`); process.exit(1); });
