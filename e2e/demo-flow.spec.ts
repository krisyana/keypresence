import { expect, test, type Browser } from '@playwright/test';

const PASSWORD = 'demo-password-1';
const SITE = { lat: -6.301234, lng: 106.701234 };
const INSIDE = { latitude: SITE.lat + 0.0001, longitude: SITE.lng, accuracy: 10 };
const OUTSIDE = { latitude: SITE.lat + 0.01, longitude: SITE.lng, accuracy: 10 }; // about 1.1 km away

async function signedIn(browser: Browser, email: string, geo = INSIDE) {
  const ctx = await browser.newContext({ geolocation: geo, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname !== '/login');
  return { ctx, page };
}

test('admin creates a site and QR; employee is accepted inside the fence, rejected outside; admin sees the records', async ({ browser }) => {
  // 1. Admin creates the site with a geofence and opens today's QR.
  const admin = await signedIn(browser, 'admin@keypresence.test');
  await admin.page.goto('/admin/sites');
  await admin.page.getByRole('button', { name: 'Add site' }).click();
  await admin.page.getByLabel('Name').fill('E2E Plaza');
  await admin.page.getByLabel('Latitude').fill(String(SITE.lat));
  await admin.page.getByLabel('Longitude').fill(String(SITE.lng));
  await admin.page.getByLabel('Radius (metres)').fill('100');
  await admin.page.getByRole('button', { name: 'Create site' }).click();
  await admin.page.getByRole('button', { name: 'QR code for E2E Plaza' }).click();
  const link = (await admin.page.locator('code.mono').textContent())!.trim();
  expect(link).toMatch(/\/s\/[\w-]+\.[\w-]+$/);
  await expect(admin.page.getByRole('img', { name: /QR code for E2E Plaza/ })).toBeVisible();
  const path = new URL(link).pathname;

  // 2. Budi is outside the fence: rejected, no record.
  const budi = await signedIn(browser, 'budi@keypresence.test', OUTSIDE);
  await budi.page.goto(path);
  await budi.page.getByRole('button', { name: 'Check in' }).click();
  await expect(budi.page.getByRole('heading', { name: 'Not accepted' })).toBeVisible();
  await expect(budi.page.getByText(/allowed distance|from the site|m from/i).first()).toBeVisible();

  // 3. Sari is inside: accepted, then checks out.
  const sari = await signedIn(browser, 'sari@keypresence.test');
  await sari.page.goto(path);
  await sari.page.getByRole('button', { name: 'Check in' }).click();
  await expect(sari.page.getByRole('heading', { name: /Checked in at E2E Plaza/ })).toBeVisible();
  await sari.page.goto('/');
  await expect(sari.page.getByText('E2E Plaza').first()).toBeVisible();
  await sari.page.goto(path);
  await sari.page.getByRole('button', { name: 'Check out' }).click();
  await expect(sari.page.getByRole('heading', { name: /Checked out at E2E Plaza/ })).toBeVisible();

  // 4. A yesterday-style code is useless: a garbage token is rejected.
  await sari.page.goto('/s/not-a-real-token');
  await expect(sari.page.getByRole('heading', { name: 'QR code problem' })).toBeVisible();

  // 5. Admin sees the record, today's summary, an answer from the assistant, and the CSV.
  await admin.page.goto('/admin/records');
  await expect(admin.page.getByRole('row', { name: /Sari Wulandari.*E2E Plaza/ })).toBeVisible();
  await expect(admin.page.getByRole('row', { name: /Budi Santoso.*E2E Plaza/ })).toHaveCount(0);
  await admin.page.goto('/admin');
  await expect(admin.page.getByRole('heading', { name: /Today/ })).toBeVisible();
  await admin.page.goto('/admin/ask');
  await admin.page.getByRole('button', { name: 'How many check-ins yesterday?' }).click();
  await expect(admin.page.locator('[aria-live]').filter({ hasText: /Check-ins for/ }).first()).toBeVisible();
  const csv = await admin.page.request.get('/api/admin/checkins/export.csv');
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('E2E Plaza');
  const rotate = await admin.page.request.get('/api/health');
  expect(rotate.ok()).toBe(true);

  for (const c of [admin, budi, sari]) await c.ctx.close();
});

test('dark theme and mobile width render without horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(23, 30, 42)');
  await ctx.close();
});
