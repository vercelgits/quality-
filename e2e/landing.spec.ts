import { test, expect } from '@playwright/test';

/**
 * Page de presentation : la premiere chose que voit un visiteur.
 */

test.describe('Presentation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('presente le produit et propose de commencer', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Creer un compte' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('mene a la connexion', async ({ page }) => {
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
  });

  test('le bouton precedent ramene a la presentation', async ({ page }) => {
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/connexion$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('depuis la connexion, on peut revenir a la presentation', async ({ page }) => {
    await page.goto('/connexion');
    await page.getByRole('button', { name: 'Decouvrir Orbit' }).click();

    await expect(page).toHaveURL(/\/$/);
  });

  test('les sections annoncees sont presentes', async ({ page }) => {
    for (const id of ['fonctionnalites', 'detail', 'vocal']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });

  test('une adresse inconnue retombe sur la presentation', async ({ page }) => {
    await page.goto('/nimporte-quoi');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('aucun defilement horizontal', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
