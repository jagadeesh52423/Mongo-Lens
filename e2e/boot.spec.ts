import { test, expect } from '@playwright/test';

/**
 * The boot splash (`#boot-splash`, defined in index.html) is removed by
 * `main.tsx` ONLY after React mounts successfully. So if any module in the
 * startup import graph throws at eval (e.g. a CommonJS file served raw to the
 * browser → "module is not defined"), the splash never goes away and #root
 * stays empty. This test asserts the app actually boots.
 *
 * Note: it runs in plain Chromium with no Tauri runtime, so `@tauri-apps/api`
 * IPC calls fail at runtime — those produce caught TypeErrors ("...reading
 * 'invoke'") which are EXPECTED here. We only fail on module-load / eval-class
 * errors, which are the boot-killers the unit suite can't see.
 */

const FATAL =
  /ReferenceError|SyntaxError|is not defined|Failed to fetch dynamically imported module|does not provide an export|Cannot find module|Unexpected (token|identifier)/i;

test('app boots past the splash with no module/eval errors', async ({ page }) => {
  const fatal: string[] = [];
  page.on('pageerror', (err) => {
    if (FATAL.test(err.message)) fatal.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && FATAL.test(msg.text())) fatal.push(`console.error: ${msg.text()}`);
  });

  await page.goto('/');

  // React mounted and dismissed the splash.
  await expect(page.locator('#boot-splash')).toHaveCount(0, { timeout: 15_000 });
  // The app rendered real content into the root.
  await expect(page.locator('#root')).not.toBeEmpty();

  expect(fatal, `Fatal boot errors:\n${fatal.join('\n')}`).toEqual([]);
});
