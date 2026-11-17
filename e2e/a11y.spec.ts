import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES: [string, string][] = [
  ['admin@keypresence.test', '/admin'], ['admin@keypresence.test', '/admin/records'], ['admin@keypresence.test', '/admin/sites'],
  ['admin@keypresence.test', '/admin/employees'], ['admin@keypresence.test', '/admin/shifts'], ['admin@keypresence.test', '/admin/settings'],
  ['admin@keypresence.test', '/admin/ask'], ['admin@keypresence.test', '/admin/audit'], ['admin@keypresence.test', '/admin/corrections'],
  ['sari@keypresence.test', '/'], ['sari@keypresence.test', '/scan'], ['sari@keypresence.test', '/history'], ['sari@keypresence.test', '/notifications'],
];

const SIZES = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } } as const;
for (const [scheme, size] of [['light', 'desktop'], ['dark', 'desktop'], ['light', 'mobile'], ['dark', 'mobile']] as const) {
  test(`axe and no horizontal scroll: ${scheme}, ${size}`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, permissions: [], viewport: SIZES[size] });
    const page = await ctx.newPage();
    const problems: string[] = [];
    for (const who of ['admin@keypresence.test', 'sari@keypresence.test']) {
      await page.goto('/login');
      if (page.url().endsWith('/login')) {
        await page.getByLabel('Email').fill(who);
        await page.getByLabel('Password').fill('demo-password-1');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await page.waitForURL((u) => u.pathname !== '/login');
      }
      for (const [email, path] of PAGES.filter(([e]) => e === who)) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 0) problems.push(`${email} ${path}: page scrolls sideways by ${over}px`);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) problems.push(`${email} ${path}: ${v.id} (${v.nodes.length}) ${v.help}`);
      }
      await page.request.post('/api/auth/logout', { data: {} });
      await page.context().clearCookies();
    }
    expect(problems).toEqual([]);
    await ctx.close();
  });
}
