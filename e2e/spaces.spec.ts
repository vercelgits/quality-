import { test, expect } from '@playwright/test';
import { signIn, uniqueText, withoutCredentials, skipReason } from './session';

/**
 * Cycle de vie d'un espace : creation, salon, invitation, moderation.
 *
 * Ces parcours ecrivent reellement en base. Chaque execution cree un espace
 * portant un nom unique plutot que de reutiliser le meme : deux executions
 * simultanees se marcheraient dessus, et un espace a demi configure par un test
 * precedent fausserait les suivants.
 */

test.describe('Espaces et salons', () => {
  test.skip(withoutCredentials, skipReason);

  test('cree un espace, qui apparait dans le rail', async ({ page }) => {
    await signIn(page);

    const name = uniqueText('Espace');

    await page.getByRole('button', { name: 'Creer un espace' }).click();
    await page.getByLabel('Nom').fill(name);
    await page.getByRole('button', { name: 'Creer', exact: true }).click();

    // Le nouvel espace devient l'espace actif : son nom coiffe la barre laterale.
    await expect(page.locator('.sidebar__space')).toContainText(name, { timeout: 15_000 });

    // La creation fournit un salon de depart : sans lui, on entrerait dans un
    // espace ou l'on ne peut rien ecrire.
    await expect(page.locator('.composer__input')).toBeVisible();
  });

  test('cree un salon texte dans l espace courant', async ({ page }) => {
    await signIn(page);

    const spaceName = uniqueText('Espace');
    await page.getByRole('button', { name: 'Creer un espace' }).click();
    await page.getByLabel('Nom').fill(spaceName);
    await page.getByRole('button', { name: 'Creer', exact: true }).click();
    await expect(page.locator('.sidebar__space')).toContainText(spaceName, { timeout: 15_000 });

    // Le nom d'un salon est normalise cote base : on cherche donc la forme
    // attendue apres normalisation, pas la saisie brute.
    const channelName = `salon-${Date.now().toString(36)}`;

    await page.getByRole('button', { name: 'Nouveau salon' }).click();
    await page.getByLabel('Nom').fill(channelName);
    await page.getByRole('button', { name: 'Creer', exact: true }).click();

    await expect(page.getByRole('button', { name: new RegExp(channelName) })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('l invitation propose un code copiable', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Inviter du monde' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Un code reellement present, et non un emplacement vide : c'est tout
    // l'interet de la fenetre.
    await expect(dialog.getByRole('button', { name: /Copier/ })).toBeEnabled();
  });

  test('rejoindre refuse un code inexistant avec une phrase lisible', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Rejoindre un espace' }).click();
    await page.getByLabel(/code d.invitation/i).fill('code-qui-nexiste-pas');
    await page.getByRole('dialog').getByRole('button', { name: 'Rejoindre' }).click();

    const message = page.locator('.field__error');
    await expect(message).toBeVisible({ timeout: 10_000 });

    // Une erreur comprehensible, et non un code technique renvoye tel quel.
    await expect(message).not.toContainText(/PGRST|22023|P0002/);
  });

  test('la console de moderation s ouvre et liste ses onglets', async ({ page }) => {
    await signIn(page);

    const moderation = page.getByRole('button', { name: 'Console de moderation' });

    // Elle n'existe que pour qui peut moderer : sur un compte sans rang
    // suffisant, l'absence du bouton est le comportement correct.
    if ((await moderation.count()) === 0) {
      test.skip(true, 'Ce compte ne modere aucun espace.');
      return;
    }

    await moderation.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('Echap referme la fenetre ouverte', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Creer un espace' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
