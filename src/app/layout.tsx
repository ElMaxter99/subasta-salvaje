import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Subasta Salvaje', template: '%s · Subasta Salvaje' },
  description: 'Subasta creativa multijugador: puja, construye tu casa y mira cómo la IA la transforma.',
};
export const viewport: Viewport = { themeColor: '#050816', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
