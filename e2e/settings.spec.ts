import { test, expect } from '@playwright/test';
import { signIn, withoutCredentials, skipReason } from './session';

/**
 * Parametres en pleine page.
 *
 * Le defilement est verifie explicitement : la page a longtemps affiche son
 * premier ecran sans jamais permettre d'atteindre le reste, faute de ligne
 * declaree sur la grille. Un test le retiendra mieux que moi.
 */

test.describe('Parametres', () => {
  test.skip(withoutCredentials, skipReason);

  async function openSettings(page: import('@playwright/test').Page): Promise<void> {
    await signIn(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await expect(page.getByRole('dialog', { name: 'Parametres' })).toBeVisible({
      timeout: 10_000,
    });
  }

  test('s ouvre sur Mon compte et liste toutes les sections', async ({ page }) => {
    await openSettings(page);

    for (const label of [
      'Mon compte',
      'Profil',
      'Confidentialite',
      'Voix et video',
      'Apparence',
      'Notifications',
      'Raccourcis',
      'Avance',
    ]) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('chaque section affiche son propre titre', async ({ page }) => {
    await openSettings(page);

    for (const label of ['Voix et video', 'Apparence', 'Notifications', 'Raccourcis']) {
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
    }
  });

  test('le contenu long defile vraiment', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Voix et video' }).click();

    // Cette section est la plus haute : si elle ne defile pas, le partage
    // d'ecran en bas de page devient inatteignable.
    const scroller = page.locator('.settings__scroll');
    const measures = await scroller.evaluate((node) => ({
      visible: node.clientHeight,
      total: node.scrollHeight,
    }));

    expect(measures.total).toBeGreaterThan(measures.visible);

    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(page.getByRole('heading', { name: /Partage d.ecran/ })).toBeInViewport();
  });

  test('Echap referme les parametres', async ({ page }) => {
    await openSettings(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Parametres' })).toBeHidden();
  });

  test('la croix referme les parametres', async ({ page }) => {
    await openSettings(page);

    await page.getByRole('button', { name: 'Fermer les parametres' }).click();
    await expect(page.getByRole('dialog', { name: 'Parametres' })).toBeHidden();
  });

  test('changer de theme agit immediatement et survit au rechargement', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Apparence' }).click();

    await page.getByRole('button', { name: 'Clair' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    // Le reglage est garde localement : le perdre au rechargement obligerait a
    // le refaire a chaque visite.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // On remet le theme sombre pour ne pas laisser le compte dans cet etat.
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Apparence' }).click();
    await page.getByRole('button', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('l etat des notifications est annonce, jamais promis a tort', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Notifications' }).click();

    // Trois issues possibles, toutes explicites : autorisees, bloquees, ou un
    // bouton pour demander. Aucune ne doit laisser la section muette.
    const granted = page.locator('.settings__ok');
    const denied = page.locator('.settings__alert');
    const ask = page.getByRole('button', { name: /Autoriser les notifications/ });

    await expect(granted.or(denied).or(ask).first()).toBeVisible();
  });
});
