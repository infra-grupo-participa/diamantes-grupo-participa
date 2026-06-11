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

const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Diamantes webapp pronto em :${port}`);
  });
});
