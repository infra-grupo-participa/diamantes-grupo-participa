/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Deploy no Node App da Hostinger: startup file = server.js (programático, lê process.env.PORT).
  // Otimização opcional (fase 8): habilitar `output: 'standalone'` e apontar o startup file do
  // painel para `.next/standalone/server.js` (deploy mais enxuto). Ver design.md §6.
};

export default nextConfig;
