import { test, expect } from '@playwright/test';

/**
 * Adaptation aux petits ecrans, sur un vrai profil d'appareil mobile.
 *
 * On verifie la structure et les cibles tactiles, pas le rendu au pixel : une
 * capture de reference se perimerait a chaque retouche de style, alors que ces
 * regles-la doivent tenir quoi qu'il arrive.
 */

test.describe('Petit ecran', () => {
  test('l ecran d accueil reste utilisable', async ({ page }) => {
    await page.goto('/connexion');

    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrer' })).toBeVisible();

    // La colonne de presentation est masquee sous 900 px : la garder
    // obligerait a defiler avant d'atteindre le formulaire.
    await expect(page.locator('.auth__pitch')).toBeHidden();
  });

  test('la page ne defile jamais horizontalement', async ({ page }) => {
    await page.goto('/connexion');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('les cibles tactiles font au moins 44 px', async ({ page }) => {
    await page.goto('/connexion');

    const boxes = await page.locator('button:visible').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, label: node.textContent?.trim().slice(0, 24) ?? '' };
      }),
    );

    // 44 px : la recommandation d'accessibilite pour une cible actionnee au
    // doigt. A la souris, 38 suffisent et l'interface les utilise.
    const tooSmall = boxes.filter((box) => box.height > 0 && box.height < 44);
    expect(tooSmall, `cibles trop petites : ${JSON.stringify(tooSmall)}`).toHaveLength(0);
  });

  test('le champ e-mail declenche le bon clavier', async ({ page }) => {
    await page.goto('/connexion');

    // `type="email"` ouvre le clavier avec l'arobase sur mobile.
    await expect(page.getByLabel('Adresse e-mail')).toHaveAttribute('type', 'email');
  });
});
