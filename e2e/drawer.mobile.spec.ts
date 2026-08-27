import { test, expect } from '@playwright/test';

/**
 * Tiroir de navigation sur petit ecran.
 *
 * Le tiroir n'existe qu'une fois connecte : ces tests demandent donc les memes
 * identifiants que les autres parcours authentifies, et se declarent ignores
 * sans eux.
 */

const email = process.env['E2E_EMAIL'];
const password = process.env['E2E_PASSWORD'];

test.describe('Navigation mobile', () => {
  test.skip(!email || !password, 'Definissez E2E_EMAIL et E2E_PASSWORD.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/connexion');
    await page.getByLabel('Adresse e-mail').fill(email!);
    await page.getByLabel('Mot de passe').fill(password!);
    await page.getByRole('button', { name: 'Entrer' }).click();
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 20_000 });
  });

  test('la conversation occupe tout l ecran, le tiroir est hors champ', async ({ page }) => {
    const nav = page.locator('.workspace__nav');
    const main = page.locator('.main');

    const navBox = await nav.boundingBox();
    const mainBox = await main.boundingBox();
    const viewport = page.viewportSize()!;

    // Le tiroir ferme est entierement a gauche du bord visible.
    expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(1);
    // La conversation, elle, prend toute la largeur.
    expect(Math.round(mainBox!.width)).toBe(viewport.width);
  });

  test('le tiroir ferme est retire du parcours clavier', async ({ page }) => {
    await expect(page.locator('.workspace__nav')).toHaveAttribute('inert', '');
  });

  test('le bouton d en-tete ouvre le tiroir', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();

    const nav = page.locator('.workspace__nav');
    await expect(page.locator('.workspace')).toHaveClass(/is-nav-open/);

    // Une fois ouvert, le tiroir est reellement visible a l'ecran.
    await expect(async () => {
      const box = await nav.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
    }).toPass({ timeout: 3_000 });

    await expect(nav).not.toHaveAttribute('inert', '');
  });

  test('le voile referme le tiroir', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await expect(page.locator('.workspace')).toHaveClass(/is-nav-open/);

    await page.getByRole('button', { name: 'Fermer la navigation' }).click();
    await expect(page.locator('.workspace')).not.toHaveClass(/is-nav-open/);
  });

  test('Echap referme le tiroir', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await expect(page.locator('.workspace')).toHaveClass(/is-nav-open/);

    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace')).not.toHaveClass(/is-nav-open/);
  });

  test('choisir un salon referme le tiroir', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await page.locator('.channel').first().click();

    // Sans cette fermeture, le tiroir masquerait la conversation demandee.
    await expect(page.locator('.workspace')).not.toHaveClass(/is-nav-open/);
  });

  test('les actions de message restent atteignables sans survol', async ({ page }) => {
    // Au doigt il n'y a pas de survol : les actions doivent etre visibles.
    const actions = page.locator('.message__actions').first();
    if ((await actions.count()) > 0) {
      await expect(actions).toBeVisible();
    }
  });

  test('aucun defilement horizontal', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
