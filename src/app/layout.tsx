import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'LavaOS', icons: { apple: '/icons/icon-192.png' } };
// viewportFit cover: a barra inferior do lavador usa env(safe-area-inset-bottom)
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f2a3a', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-enxague text-tinta antialiased">{children}</body>
    </html>
  );
}
