/**
 * Startup file para o Node App da Hostinger (hPanel).
 * Sobe o Next em produção lendo process.env.PORT (a Hostinger define a porta).
 * Requer build prévio: `npm ci && npm run build`.
 *
 * Alternativa (build standalone): apontar o startup file do painel direto para
 * `.next/standalone/server.js` (gerado por output:'standalone').
 */
const next = require('next');
const { createServer } = require('http');

// Guarda contra PORT inválida/NaN (ex.: variável vazia ou não numérica): cai pra 3000.
const parsedPort = parseInt(process.env.PORT || '3000', 10);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Diamantes webapp pronto em :${port}`);
  });
});
