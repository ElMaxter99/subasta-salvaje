import type { NextConfig } from 'next';

/** Archivos de sharp para Linux glibc x64 (el entorno de Vercel). */
const SHARP_FILES = ['./node_modules/sharp/**/*', './node_modules/@img/sharp-linux-x64/**/*', './node_modules/@img/sharp-libvips-linux-x64/**/*', './node_modules/semver/**/*', './node_modules/detect-libc/**/*', './node_modules/@img/colour/**/*'];

/** Tipografías TTF de la marca que leen en ejecución el podio y las imágenes Open Graph (src/lib/seo/fonts.ts; docs/FUENTE-PODIO.md). */
const FONT_FILES = ['./src/assets/fonts/*.ttf'];

const config: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // PGlite (Postgres WASM) sólo se usa en el modo demo: no se empaqueta.
  serverExternalPackages: ['@electric-sql/pglite'],
  // Tamaño de las funciones en Vercel (cuenta para el almacenamiento del plan): se quita de la traza lo que NO se usa en producción.
  outputFileTracingExcludes: {
    '/**': [
      'node_modules/@electric-sql/pglite/**', // solo modo demo / tests (Postgres WASM, 27 MB)
      'node_modules/@img/sharp-libvips-linuxmusl-x64/**', // Vercel usa glibc (linux-x64): sobran las variantes musl y wasm
      'node_modules/@img/sharp-linuxmusl-x64/**',
      'node_modules/@img/sharp-wasm32/**',
      'subasta-salvaje-assets/**',
      'supabase/**',
      'docs/**',
      'e2e/**',
      'tests/**',
      'scripts/**',
      '.demo-data/**',
      // sharp (≈20 MB con libvips) solo lo usan los trabajos de imágenes de IA y la normalización de subidas: se añade de nuevo abajo a las rutas que lo necesitan.
      'node_modules/sharp/**',
      'node_modules/@img/**',
    ],
  },
  outputFileTracingIncludes: {
    '/api/public/games/*/podium': FONT_FILES,
    '/game/*/*/opengraph-image': FONT_FILES,
    // Panel de plantillas del sistema: etiquetas del lote para casar fotos de la biblioteca (ver library-match-service.ts)
    '/api/admin/system-templates': ['./docs/plantillas-sistema/lote.json'],
    '/api/jobs/process': SHARP_FILES,
    '/api/games/*/actions': SHARP_FILES,
    '/api/games/*/jobs': SHARP_FILES,
    // Subidas e importaciones: normalizan la imagen al formato interno con sharp
    '/api/games/*/initial-image': SHARP_FILES,
    '/api/games/*/item-image': SHARP_FILES,
    '/api/games/*/import-photos': SHARP_FILES,
  },
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
