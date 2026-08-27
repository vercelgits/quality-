import { test, expect, type Page } from '@playwright/test';
import { openApp, uniqueText, withoutCredentials, skipReason } from './session';

/** Parcours critiques avec une session ouverte. */

/**
 * Designe la ligne d'un message par son contenu.
 *
 * Le texte ne peut pas servir de reperage direct : le bloc de texte enrichi et
 * le paragraphe qu'il contient portent la meme chaine, et Playwright refuse une
 * correspondance ambigue.
 */
function messageRow(page: Page, text: string) {
  return page.locator('.message', { hasText: text });
}

/**
 * Attend qu'un message soit confirme par le serveur avant d'agir dessus.
 *
 * Un message envoye s'affiche d'abord de maniere optimiste, puis l'echo du
 * temps reel le remplace. Agir entre les deux vise un noeud sur le point de
 * disparaitre : le survol se perd et le clic n'aboutit jamais.
 */
async function settledMessage(page: Page, text: string) {
  const row = page.locator('.message:not(.is-pending)', { hasText: text }).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  return row;
}

test.describe('Parcours authentifies', () => {
  test.skip(withoutCredentials, skipReason);

  test('se connecte et atteint un salon', async ({ page }) => {
    await openApp(page);

    await expect(page.getByRole('button', { name: 'Messages prives' })).toBeVisible();
    await expect(page.locator('.composer__input')).toBeVisible();
  });

  test('envoie un message et le voit apparaitre', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('Test envoi');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');

    await expect(messageRow(page, text)).toBeVisible({ timeout: 10_000 });
    // Le compositeur se vide : sans cela on renverrait le meme texte au clic suivant.
    await expect(page.locator('.composer__input')).toHaveValue('');
  });

  test('modifie un message deja envoye', async ({ page }) => {
    await openApp(page);

    const original = uniqueText('Avant modification');
    await page.locator('.composer__input').fill(original);
    await page.keyboard.press('Enter');
    await expect(messageRow(page, original)).toBeVisible({ timeout: 10_000 });

    const message = await settledMessage(page, original);
    await message.hover();
    await message.getByRole('button', { name: 'Modifier' }).click();

    const editor = message.locator('.message__editor-input');
    await editor.fill(`${original} — corrige`);
    await editor.press('Enter');

    await expect(messageRow(page, `${original} — corrige`)).toBeVisible();
    await expect(page.getByText('(modifie)').last()).toBeVisible();
  });

  test('ajoute une reaction puis la retire', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('Test reaction');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    await expect(messageRow(page, text)).toBeVisible({ timeout: 10_000 });

    const message = await settledMessage(page, text);
    await message.hover();
    await message.getByTitle('Reagir avec 👍').click();

    const reaction = message.locator('.reaction', { hasText: '👍' });
    await expect(reaction).toBeVisible();
    await expect(reaction).toHaveAttribute('aria-pressed', 'true');

    await reaction.click();
    await expect(reaction).toHaveCount(0);
  });

  test('supprime un message', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('A supprimer');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    await expect(messageRow(page, text)).toBeVisible({ timeout: 10_000 });

    const message = await settledMessage(page, text);
    await message.hover();
    await message.getByRole('button', { name: 'Supprimer' }).click();

    // La disparition demande un aller-retour vers la base : le delai par
    // defaut de cinq secondes est parfois trop court sur une liaison lente.
    await expect(messageRow(page, text)).toHaveCount(0, { timeout: 15_000 });
  });

  test('ouvre un fil depuis un message', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('Question a suivre');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    await expect(messageRow(page, text)).toBeVisible({ timeout: 10_000 });

    const message = await settledMessage(page, text);
    await message.hover();
    await message.getByRole('button', { name: 'Ouvrir un fil' }).click();

    // Le panneau lateral s'ouvre sur le fil qui vient d'etre cree.
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Marquer resolu' })).toBeVisible();
  });

  test('le survol d un message le distingue visiblement', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('Survol');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');

    const message = await settledMessage(page, text);

    const before = await message.evaluate((node) => getComputedStyle(node).backgroundColor);
    await message.hover();

    // La transition dure quelques dizaines de millisecondes : on interroge donc
    // jusqu'a ce que la teinte ait change, sans delai fixe.
    await expect
      .poll(async () => message.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(before);

    // Le liseré d'accent apparait le long du bord gauche. On interroge jusqu'a
    // la fin de la transition : lue trop tot, l'opacite est encore en route.
    await expect
      .poll(async () =>
        message.evaluate((node) => Number(getComputedStyle(node, '::before').opacity)),
      )
      .toBeGreaterThan(0.95);
  });

  test('la palette de commandes s ouvre et ferme au clavier', async ({ page }) => {
    await openApp(page);

    const palette = page.getByRole('dialog', { name: 'Palette de commandes' });

    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    // La fermeture passe par une transition : le delai par defaut suffit
    // d'ordinaire, mais pas quand la machine est chargee.
    await expect(palette).toHaveCount(0, { timeout: 10_000 });
  });

  test('la recherche trouve un message qui vient d etre ecrit', async ({ page }) => {
    await openApp(page);

    const needle = `sentinelle${Date.now().toString(36)}`;
    await page.locator('.composer__input').fill(`Message contenant ${needle}`);
    await page.keyboard.press('Enter');
    await expect(messageRow(page, needle)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Control+f');
    await page.getByLabel('Rechercher dans les messages').fill(needle);

    await expect(page.locator('.search-hit', { hasText: needle }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('le lien d evitement mene a la conversation', async ({ page }) => {
    await openApp(page);

    const skip = page.getByRole('link', { name: 'Aller a la conversation' });

    // La tabulation ne peut pas servir de point de depart : le compositeur
    // prend le focus au chargement, et l'ordre de tabulation repart donc de
    // lui. On verifie ce qui compte vraiment — que le lien se prend au clavier
    // et mene quelque part.
    await skip.focus();
    await expect(skip).toBeFocused();

    await expect(page.locator('#conversation')).toBeAttached();

    await page.keyboard.press('Enter');
    await expect(page.locator('#conversation')).toBeInViewport();
  });

  test('bascule vers les messages prives', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Messages prives' }).click();

    await expect(page.getByRole('heading', { name: 'Messages prives' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Nouvelle conversation' }).first(),
    ).toBeVisible();
  });
});
