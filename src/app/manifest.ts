import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Subasta Salvaje',
    short_name: 'Subasta',
    description: 'Subasta creativa multijugador: parte de una imagen base, puja por elementos y transfórmala a tu manera.',
    start_url: '/',
    display: 'standalone',
    background_color: '#050816',
    theme_color: '#050816',
    lang: 'es',
    icons: [
      { src: '/assets/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
