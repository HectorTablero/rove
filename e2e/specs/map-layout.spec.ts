import { expect, test } from '../support/app';
import { mapHeading } from '../support/routes';

/* The map page is full-bleed: nothing scrolls, no scrollbar gutter on the right, and the map
   itself has real height. CI builds without an Amap key, so there the fallback panel stands in
   for the map; a local build with VITE_AMAP_JS_KEY also checks the SDK's container. */
test('the map page fills the viewport and does not scroll', async ({ app: page }) => {
  await page.goto('/map');
  await expect(mapHeading(page)).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    client: document.documentElement.clientWidth,
    scrollable: document.documentElement.scrollHeight > window.innerHeight,
    overflow: getComputedStyle(document.documentElement).overflow,
  }));
  expect(layout.client).toBe(layout.viewport); // no reserved gutter
  expect(layout.overflow).toBe('hidden');
  expect(layout.scrollable).toBe(false);

  const amap = page.locator('.amap-container');
  if (await amap.count()) {
    const box = await amap.boundingBox();
    expect(box?.height).toBeGreaterThan(200);
    expect(box?.width).toBe(layout.viewport - (layout.viewport >= 768 ? 224 : 0)); // minus sidebar
  }
});
