import { test, expect, type Page } from '@playwright/test';
import { openApp, uniqueText, withoutCredentials, skipReason } from './session';

/**
 * Cycle de vie d'un espace : creation, salon, invitation, moderation.
 *
 * Ces parcours ecrivent reellement en base. Chaque execution cree un espace
 * portant un nom unique plutot que de reutiliser le meme : deux executions
 * simultanees se marcheraient dessus, et un espace a demi configure par un test
 * precedent fausserait les suivants.
 */

/**
 * Champs de la fenetre ouverte.
 *
 * Les fenetres reposent sur `<dialog>` : celles qui sont fermees restent dans
 * le document, et une etiquette aussi commune que « Nom » y apparait plusieurs
 * fois. On se limite donc a la fenetre reellement ouverte.
 */
function openDialog(page: Page) {
  return page.locator('dialog[open]');
}

test.describe('Espaces et salons', () => {
  test.skip(withoutCredentials, skipReason);

  /**
   * Cree un espace, ou renvoie `null` si le quota horaire est atteint.
   *
   * La base n'autorise que cinq espaces par heure et par compte. Une suite
   * relancee plusieurs fois y arrive vite : le refus est alors le comportement
   * correct, et on verifie qu'il est annonce lisiblement plutot que de le
   * compter comme une regression.
   */
  async function createSpace(page: Page, name: string): Promise<string | null> {
    await page.getByRole('button', { name: 'Creer un espace' }).click();
    await openDialog(page).getByLabel('Nom').fill(name);
    await openDialog(page).getByRole('button', { name: 'Creer', exact: true }).click();

    const sidebar = page.locator('.sidebar__space');
    const toast = page.locator('.toast');

    await expect(sidebar.filter({ hasText: name }).or(toast)).toBeVisible({ timeout: 15_000 });

    if (await sidebar.textContent().then((t) => t?.includes(name) ?? false)) return name;

    const message = (await toast.textContent()) ?? '';
    expect(message).not.toMatch(/PGRST|53400|22023/);
    expect(message.length).toBeGreaterThan(10);
    return null;
  }

  test('cree un espace, qui apparait dans le rail', async ({ page }) => {
    await openApp(page);

    const created = await createSpace(page, uniqueText('Espace'));
    if (!created) {
      test.skip(true, 'Quota horaire d espaces atteint ; le refus est bien annonce.');
      return;
    }

    // La creation fournit un salon de depart : sans lui, on entrerait dans un
    // espace ou l'on ne peut rien ecrire.
    await expect(page.locator('.composer__input')).toBeVisible();
  });

  test('cree un salon texte dans l espace courant', async ({ page }) => {
    await openApp(page);

    // On travaille dans l'espace deja ouvert plutot que d'en creer un : le
    // quota horaire ferait echouer ce test pour une raison etrangere aux
    // salons.

    // Le nom d'un salon est normalise cote base : on cherche donc la forme
    // attendue apres normalisation, pas la saisie brute.
    const channelName = `salon-${Date.now().toString(36)}`;

    await page.getByRole('button', { name: 'Nouveau salon' }).click();
    await openDialog(page).getByLabel('Nom').fill(channelName);
    await openDialog(page).getByRole('button', { name: 'Creer', exact: true }).click();

    // La ligne du salon, pas son bouton de reglages : ce dernier porte aussi le
    // nom du salon dans son etiquette.
    await expect(page.locator('.channel', { hasText: channelName })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('l invitation propose un code copiable', async ({ page }) => {
    await openApp(page);

    await page.locator('.sidebar__space').click();

    const dialog = openDialog(page);
    await expect(dialog).toBeVisible();

    // Un code reellement present, et non un emplacement vide : c'est tout
    // l'interet de la fenetre.
    await expect(dialog.getByRole('button', { name: /Copier/ })).toBeEnabled();
  });

  test('rejoindre refuse un code inexistant avec une phrase lisible', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Rejoindre un espace' }).click();
    await openDialog(page).getByLabel(/code d.invitation/i).fill('code-qui-nexiste-pas');
    await openDialog(page).getByRole('button', { name: 'Rejoindre' }).click();

    const message = page.locator('.field__error');
    await expect(message).toBeVisible({ timeout: 10_000 });

    // Une erreur comprehensible, et non un code technique renvoye tel quel.
    await expect(message).not.toContainText(/PGRST|22023|P0002/);
  });

  test('la console de moderation s ouvre et liste ses onglets', async ({ page }) => {
    await openApp(page);

    const moderation = page.getByRole('button', { name: 'Console de moderation' });

    // Elle n'existe que pour qui peut moderer : sur un compte sans rang
    // suffisant, l'absence du bouton est le comportement correct.
    if ((await moderation.count()) === 0) {
      test.skip(true, 'Ce compte ne modere aucun espace.');
      return;
    }

    await moderation.click();
    await expect(openDialog(page)).toBeVisible();
  });

  test('les reglages d un salon s ouvrent depuis sa ligne', async ({ page }) => {
    await openApp(page);

    const row = page.locator('.channel[data-kind="text"]').first();
    await row.hover();

    const manage = row.locator('.channel__manage');
    if ((await manage.count()) === 0) {
      test.skip(true, 'Ce compte n administre aucun espace.');
      return;
    }

    await manage.click();
    await expect(openDialog(page)).toBeVisible();
    await expect(openDialog(page).getByLabel('Nom')).toBeVisible();
  });

  test('la suppression d un salon exige d en retaper le nom', async ({ page }) => {
    await openApp(page);

    const row = page.locator('.channel[data-kind="text"]').first();
    const name = ((await row.locator('.channel__name').textContent()) ?? '').trim();

    await row.hover();
    const manage = row.locator('.channel__manage');
    if ((await manage.count()) === 0) {
      test.skip(true, 'Ce compte n administre aucun espace.');
      return;
    }
    await manage.click();

    const dialog = openDialog(page);
    const remove = dialog.getByRole('button', { name: 'Supprimer' });

    // Rien ne part sur un clic distrait : la suppression emporte tous les
    // messages du salon.
    await expect(remove).toBeDisabled();

    await dialog.getByRole('textbox', { name: /Tapez .* pour confirmer/ }).fill('nimporte quoi');
    await expect(remove).toBeDisabled();

    await dialog.getByRole('textbox', { name: /Tapez .* pour confirmer/ }).fill(name);
    await expect(remove).toBeEnabled();
  });

  test('Echap referme la fenetre ouverte', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Creer un espace' }).click();
    await expect(openDialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(openDialog(page)).toHaveCount(0);
  });
});
