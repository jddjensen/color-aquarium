import { test, expect } from '@playwright/test';

test('a guest can color, submit, and see the aquarium receive the fish', async ({ page }) => {
  const before = await page.request.get('/api/fish');
  const initialCount = (await before.json()).fish.length;
  await page.goto('/color');
  await page.locator('.fish-card').first().click();
  await page.getByRole('button', { name: 'Color This Fish' }).click();
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas did not render');

  for (const yFraction of [0.42, 0.5, 0.58]) {
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * yFraction);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * yFraction, { steps: 12 });
    await page.mouse.up();
  }

  const submit = page.getByRole('button', { name: 'Send to Aquarium' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('#lookUpBanner')).toHaveClass(/show/);

  await page.goto('/aquarium');
  await expect(page.locator('#count')).toContainText(`${initialCount + 1} fish today`);
  await expect(page.locator('#threeAquarium')).toBeVisible();
});
