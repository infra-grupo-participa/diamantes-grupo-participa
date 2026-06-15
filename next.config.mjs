/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cabeçalhos de segurança básicos aplicados a todas as rotas. Sem CSP estrita
  // de propósito — o app conversa com Supabase/ClickUp/Resend e uma CSP rígida
  // quebraria essas chamadas; preferimos não enviar a arriscar falsos positivos.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HSTS conservador (sem preload/includeSubDomains) para não travar subdomínios.
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
        ],
      },
    ];
  },
};

export default nextConfig;
