export const PROD_ORIGIN = 'https://diamantes.grupoparticipa.app.br';

const LOCALHOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Origin confiável para montar links que vão por e-mail.
 *
 * Duas armadilhas evitadas aqui:
 *  1. `new URL(request.url).origin` devolve `localhost:PORT` em produção — o app roda
 *     atrás do proxy da Hostinger Node App —, o que produziria links inúteis no e-mail.
 *  2. O header Host é controlado pelo cliente: aceitar qualquer valor faria o link de
 *     redefinição apontar para o domínio de um atacante. Por isso a allowlist.
 */
export function safeOrigin(request: Request): string {
  const h = request.headers;
  const host = (h.get('x-forwarded-host') || h.get('host') || '').trim().toLowerCase();

  if (LOCALHOST_RE.test(host)) return 'http://' + host;

  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const origin = `${proto}://${host}`;
  return origin === PROD_ORIGIN ? origin : PROD_ORIGIN;
}
