/**
 * Gera os ícones PNG do PWA (public/icons) a partir de um SVG, com o Chromium do Playwright (sem dependência nova).
 * Uso: node scripts/gerar-icones.ts
 */
import { chromium } from '@playwright/test';

// gota d'água branca com brilho amarelo sobre a tinta da marca; `escala` encolhe a gota para a zona segura do maskable (círculo de 80%)
const svg = (escala: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f2a3a"/>
  <g transform="translate(256 256) scale(${escala}) translate(-256 -256)">
    <path d="M256 56C256 56 104 236 104 332a152 152 0 0 0 304 0C408 236 256 56 256 56Z" fill="#ffffff"/>
    <path d="M190 330a66 66 0 0 0 66 66" fill="none" stroke="#f2b705" stroke-width="28" stroke-linecap="round"/>
  </g>
</svg>`;

const ICONES = [
  { arquivo: 'icon-192.png', tamanho: 192, escala: 0.8 },
  { arquivo: 'icon-512.png', tamanho: 512, escala: 0.8 },
  { arquivo: 'icon-maskable-512.png', tamanho: 512, escala: 0.6 },
];

const browser = await chromium.launch();
try {
  for (const i of ICONES) {
    const page = await browser.newPage({ viewport: { width: i.tamanho, height: i.tamanho } });
    await page.setContent(`<body style="margin:0">${svg(i.escala).replace('<svg ', `<svg width="${i.tamanho}" height="${i.tamanho}" `)}</body>`);
    await page.screenshot({ path: `public/icons/${i.arquivo}`, omitBackground: false });
    await page.close();
  }
} finally {
  await browser.close();
}
