import type { MetadataRoute } from 'next';

// shortcut: instalável sem cache offline (sistema 100% online, sem service worker); adicionar worker se um dia houver modo offline
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LavaOS',
    short_name: 'LavaOS',
    description: 'Fila do lava jato no celular do lavador.',
    lang: 'pt-BR',
    start_url: '/lavador',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#0f2a3a',
    background_color: '#0f2a3a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
