// Captures README screenshots from a running demo server (npm run demo). Usage: npx tsx scripts/screenshots.ts
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:8787';
mkdirSync('docs/screenshots', { recursive: true });
const browser = await chromium.launch();
async function login(email: string, opts: object) {
  const ctx = await browser.newContext({ ...opts, geolocation: { latitude: -6.175392, longitude: 106.827153, accuracy: 10 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname !== '/login');
  return page;
}
const shots: [string, string, string, object, string][] = [
  ['admin@keypresence.test', '/admin', 'admin-overview-light', { viewport: { width: 1200, height: 900 }, colorScheme: 'light' }, 'Overview'],
  ['admin@keypresence.test', '/admin/records', 'admin-records-dark', { viewport: { width: 1200, height: 800 }, colorScheme: 'dark' }, 'Records'],
  ['admin@keypresence.test', '/admin/ask', 'admin-ask-light', { viewport: { width: 1000, height: 800 }, colorScheme: 'light' }, 'Ask'],
  ['sari@keypresence.test', '/', 'employee-home-mobile', { viewport: { width: 390, height: 780 }, colorScheme: 'light', deviceScaleFactor: 2 }, ''],
];
for (const [email, path, name, opts] of shots) {
  const page = await login(email, opts);
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  if (name === 'admin-ask-light') { await page.getByRole('button', { name: 'Late arrivals by site last week' }).click(); await page.waitForTimeout(800); }
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: false });
  await page.context().close();
}
await browser.close();
