import { test, expect } from '@playwright/test';

/**
 * Ecran d'accueil : ce que voit quelqu'un qui n'a pas de compte.
 *
 * Ces tests ne demandent aucun identifiant, donc ils tournent partout, y
 * compris en integration continue sur un depot fraichement clone.
 */

test.describe('Ecran de connexion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/connexion');
  });

  test('affiche le formulaire de connexion par defaut', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Se connecter' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
  });

  test('le bouton reste inactif tant que la saisie est incomplete', async ({ page }) => {
    const submit = page.getByRole('button', { name: 'Entrer' });
    await expect(submit).toBeDisabled();

    // Une adresse sans domaine ne doit pas suffire a activer le bouton.
    await page.getByLabel('Adresse e-mail').fill('pasunemail');
    await page.getByLabel('Mot de passe').fill('motdepasse');
    await expect(submit).toBeDisabled();

    await page.getByLabel('Adresse e-mail').fill('camille@exemple.fr');
    await expect(submit).toBeEnabled();
  });

  test('bascule vers la creation de compte et demande un pseudo', async ({ page }) => {
    await page.getByRole('tab', { name: 'Creer un compte' }).click();

    await expect(page.getByLabel('Pseudo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Creer mon espace' })).toBeVisible();
  });

  test('refuse un pseudo aux caracteres interdits', async ({ page }) => {
    await page.getByRole('tab', { name: 'Creer un compte' }).click();
    await page.getByLabel('Pseudo').fill('camille du 92!');

    await expect(page.getByText(/lettres, chiffres, point, tiret/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Creer mon espace' })).toBeDisabled();
  });

  test('propose la recuperation de mot de passe', async ({ page }) => {
    await page.getByRole('button', { name: 'Mot de passe oublie ?' }).click();

    await expect(page.getByRole('heading', { name: 'Mot de passe oublie' })).toBeVisible();
    // Le champ mot de passe disparait : on ne demande que l'adresse.
    await expect(page.getByLabel('Mot de passe')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Envoyer le lien' })).toBeVisible();
  });

  test('revient a la connexion depuis la recuperation', async ({ page }) => {
    await page.getByRole('button', { name: 'Mot de passe oublie ?' }).click();
    await page.getByRole('button', { name: 'Revenir a la connexion' }).click();

    await expect(page.getByRole('tab', { name: 'Se connecter' })).toBeVisible();
  });
});

test.describe('Accessibilite de l accueil', () => {
  test('la premiere tabulation atteint un element utilisable', async ({ page }) => {
    await page.goto('/connexion');

    // Sans focus prealable sur le document, la tabulation ne deplace rien.
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Tab');

    // Le lien d'evitement n'existe que dans l'application : ici il n'y aurait
    // rien a sauter. On verifie donc simplement qu'aucune zone morte ne
    // precede les commandes du formulaire.
    const focused = await page.evaluate(() => {
      const node = document.activeElement;
      return node && node !== document.body ? node.tagName : null;
    });

    expect(focused).not.toBeNull();
  });

  test('les champs sont atteignables au clavier', async ({ page }) => {
    await page.goto('/connexion');

    await page.evaluate(() => document.body.focus());

    const reachable: string[] = [];
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      reachable.push(
        await page.evaluate(() => document.activeElement?.getAttribute('id') ?? ''),
      );
    }

    expect(reachable).toContain('auth-email');
    expect(reachable).toContain('auth-password');
  });

  test('chaque champ porte une etiquette reellement liee', async ({ page }) => {
    await page.goto('/connexion');

    // `getByLabel` echoue si l'etiquette n'est pas associee au champ : c'est
    // donc la verification elle-meme, pas seulement une facon de le cibler.
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
  });

  test('le champ focalise porte un halo visible', async ({ page }) => {
    await page.goto('/connexion');
    await page.getByLabel('Adresse e-mail').focus();

    const shadow = await page
      .getByLabel('Adresse e-mail')
      .evaluate((node) => getComputedStyle(node).boxShadow);

    expect(shadow).not.toBe('none');
  });
});

test.describe('Theme', () => {
  /**
   * Clarte du fond, ramenee sur 0-255.
   *
   * Chromium ne serialise pas `oklch()` en `rgb()` : la valeur calculee reste
   * en oklch, dont la premiere composante est deja une clarte perceptuelle.
   * Moyenner les trois nombres donnerait n'importe quoi, la teinte allant
   * jusqu'a 360.
   */
  async function bodyBrightness(page: import('@playwright/test').Page): Promise<number> {
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );

    const oklch = /^oklch\(\s*([\d.]+)(%?)/.exec(background);
    if (oklch) {
      const value = Number(oklch[1]);
      const lightness = oklch[2] === '%' ? value / 100 : value;
      return lightness * 255;
    }

    const rgb = background.match(/[\d.]+/g);
    if (!rgb || rgb.length < 3) {
      throw new Error(`Couleur de fond non reconnue : ${background}`);
    }
    return (Number(rgb[0]) + Number(rgb[1]) + Number(rgb[2])) / 3;
  }

  test('suit le reglage sombre du systeme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/connexion');

    expect(await bodyBrightness(page)).toBeLessThan(110);
  });

  test('suit le reglage clair du systeme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/connexion');

    expect(await bodyBrightness(page)).toBeGreaterThan(180);
  });

  test('coupe les animations quand le systeme le demande', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/connexion');

    const duration = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--duration-normal').trim(),
    );

    expect(duration).toBe('0ms');
  });
});
