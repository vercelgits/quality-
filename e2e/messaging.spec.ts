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
/*
 * Le message, une fois la liste immobile.
 *
 * Attendre la fin de l'envoi ne suffit pas : la liste defile encore vers le
 * bas, en douceur, pendant une fraction de seconde. Playwright refuse alors de
 * cliquer — « element is not stable » — et le test echoue sur une barre
 * d'actions parfaitement correcte, simplement en mouvement. Le defaut
 * s'aggravait a mesure que le salon de test se remplissait, la course au bas
 * de liste s'allongeant a chaque passe.
 *
 * On attend donc que la position du message ne bouge plus d'une image a
 * l'autre, plutot que de deviner un delai.
 */
async function settledMessage(page: Page, text: string) {
  const row = page.locator('.message:not(.is-pending)', { hasText: text }).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();

  await expect
    .poll(
      async () => {
        const avant = await row.boundingBox();
        await page.waitForTimeout(120);
        const apres = await row.boundingBox();
        return avant && apres && Math.abs(avant.y - apres.y) < 1;
      },
      { timeout: 10_000, message: 'la liste continue de defiler' },
    )
    .toBe(true);

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

    // Supprimer est definitif et le bouton voisine « Modifier » : une
    // confirmation s'interpose, et elle rappelle le message vise.
    const confirmation = page.getByRole('dialog', { name: 'Supprimer ce message ?' });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('.confirm-quote')).toContainText(text);

    await confirmation.getByRole('button', { name: 'Supprimer' }).click();

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

  /*
   * Le geste qu'on tente en premier devant un visage, c'est de cliquer dessus.
   * Il menait au menu d'actions ; il mene maintenant au profil, et le clic
   * droit garde les actions. Les deux sont verifies, car intervertir les deux
   * gestes serait invisible en relecture et evident a l'usage.
   */
  test('cliquer l avatar puis le nom ouvre la fiche de profil', async ({ page }) => {
    await openApp(page);

    /*
     * On vise une tete de groupe.
     *
     * Les messages consecutifs d'une meme personne sont regroupes : seuls les
     * premiers portent un avatar et un nom, les suivants n'ont qu'une heure
     * dans la gouttiere. Un message qu'on vient d'ecrire est donc, le plus
     * souvent, precisement celui qui n'a rien a cliquer.
     */
    const message = page.locator('.message:not(.is-grouped)').last();
    await expect(message).toBeVisible({ timeout: 10_000 });

    const fiche = page.getByRole('dialog', { name: 'Profil' });

    await message.locator('.message__avatar-button').click();
    await expect(fiche).toBeVisible();
    await expect(fiche.locator('.profile__name')).toBeVisible();

    // Aucun compteur d'activite : un nombre de messages ne dit rien de
    // personne, et sous un visage il se lit comme une note.
    await expect(fiche.locator('.profile-stat')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(fiche).toBeHidden();

    await message.locator('.message__author').click();
    await expect(fiche).toBeVisible();
  });

  test('le clic droit sur un message ouvre les actions du message', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('Menu');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    const message = await settledMessage(page, text);

    await message.click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Le message d'abord — c'est lui qu'on a vise. Le profil de l'auteur reste
    // atteignable, mais plus bas.
    await expect(menu.getByRole('menuitem', { name: 'Repondre' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Copier le texte' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Epingler le message' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /profil de l/i })).toBeVisible();

    // Sur son propre message : supprimer. Signaler n'aurait pas de sens.
    await expect(menu.getByRole('menuitem', { name: 'Supprimer le message' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Signaler le message' })).toHaveCount(0);

    // Echap referme : un menu qu'on ne peut fermer qu'en cliquant ailleurs
    // piege qui navigue au clavier.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('le menu se replace pour ne pas sortir de l ecran', async ({ page }) => {
    await openApp(page);

    const text = uniqueText('Bord');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    const message = await settledMessage(page, text);

    // Clic tout pres du bord droit : le menu doit basculer vers l'interieur.
    const boite = (await message.boundingBox())!;
    await page.mouse.click(boite.x + boite.width - 4, boite.y + 6, { button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    const rect = (await menu.boundingBox())!;
    const largeur = page.viewportSize()!.width;
    expect(rect.x + rect.width).toBeLessThanOrEqual(largeur);

    await page.keyboard.press('Escape');
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
