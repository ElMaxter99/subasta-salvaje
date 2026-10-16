import type { Metadata, Viewport } from 'next';
import { Baloo_2, Nunito } from 'next/font/google';
import './globals.css';

// Fuentes alojadas por next/font (se sirven desde nuestro dominio, con font-display: swap: no bloquean el texto).
const baloo = Baloo_2({ subsets: ['latin', 'latin-ext'], weight: ['700', '800'], variable: '--font-baloo', display: 'swap' });
const nunito = Nunito({ subsets: ['latin', 'latin-ext'], variable: '--font-nunito', display: 'swap' });

const DESCRIPTION = 'Subasta creativa multijugador: puja, construye tu casa y mira cómo la IA la transforma.';

export const metadata: Metadata = {
  title: { default: 'Subasta Salvaje', template: '%s · Subasta Salvaje' },
  description: DESCRIPTION,
  applicationName: 'Subasta Salvaje',
  icons: {
    icon: [
      { url: '/assets/brand/favicon.svg', type: 'image/svg+xml' },
      { url: '/assets/brand/favicon-64.png', type: 'image/png', sizes: '64x64' },
    ],
    apple: [{ url: '/assets/brand/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'Subasta Salvaje',
    title: 'Subasta Salvaje',
    description: DESCRIPTION,
    locale: 'es_ES',
    images: [{ url: '/assets/brand/og-image.png', width: 1200, height: 630, alt: 'Subasta Salvaje: la mascota con corona y martillo sobre el logotipo' }],
  },
  twitter: { card: 'summary_large_image', title: 'Subasta Salvaje', description: DESCRIPTION, images: ['/assets/brand/og-image.png'] },
};
export const viewport: Viewport = { themeColor: '#050816', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${baloo.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
