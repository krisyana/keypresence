// Renders the SVG icon to the PNG sizes the web manifest needs. Run once: npx tsx scripts/make-icons.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('src/web/public/icon.svg', 'utf8');
const browser = await chromium.launch();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 64]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = size - pad * 2;
  await page.setContent(`<body style="margin:0;background:#0b6e6e;display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  writeFileSync(`src/web/public/${name}.png`, await page.screenshot({ omitBackground: false }));
}
await browser.close();
