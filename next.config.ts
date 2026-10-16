import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // PGlite (Postgres WASM) sólo se usa en el modo demo: no se empaqueta.
  serverExternalPackages: ['@electric-sql/pglite'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};
export default config;
