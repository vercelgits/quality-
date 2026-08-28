import { test, expect } from '@playwright/test';
import { openApp, withoutCredentials, skipReason } from './session';

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
    await openApp(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await expect(page.getByRole('dialog', { name: 'Parametres' })).toBeVisible({
      timeout: 10_000,
    });
  }

  /*
   * La colonne de gauche, et elle seule.
   *
   * Plusieurs sections portent des boutons dont l'intitule contient celui
   * d'une section — « Modifier mon profil » contient « Profil ». Chercher dans
   * la page entiere en attrapait deux et faisait echouer un test qui ne parle
   * que de la navigation.
   */
  function nav(page: import('@playwright/test').Page) {
    return page.getByRole('navigation', { name: 'Sections des parametres' });
  }

  test('s ouvre sur Mon compte et liste toutes les sections', async ({ page }) => {
    await openSettings(page);

    for (const label of [
      'Mon compte',
      'Profil',
      'Confidentialite',
      'Apparence',
      'Accessibilite',
      'Discussion',
      'Voix et video',
      'Notifications',
      'Raccourcis',
      'Avance',
    ]) {
      await expect(nav(page).getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('chaque section affiche son propre titre', async ({ page }) => {
    await openSettings(page);

    for (const label of [
      'Voix et video',
      'Apparence',
      'Accessibilite',
      'Discussion',
      'Notifications',
      'Raccourcis',
    ]) {
      await nav(page).getByRole('button', { name: label }).click();
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
    await nav(page).getByRole('button', { name: 'Apparence' }).click();

    await page.getByRole('button', { name: 'Clair' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    // Le reglage est garde localement : le perdre au rechargement obligerait a
    // le refaire a chaque visite.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // On remet le theme sombre pour ne pas laisser le compte dans cet etat.
    await page.getByRole('button', { name: 'Preferences' }).click();
    await nav(page).getByRole('button', { name: 'Apparence' }).click();
    await page.getByRole('button', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('l etat des notifications est annonce, jamais promis a tort', async ({ page }) => {
    await openSettings(page);
    await nav(page).getByRole('button', { name: 'Notifications' }).click();

    // Trois issues possibles, toutes explicites : autorisees, bloquees, ou un
    // bouton pour demander. Aucune ne doit laisser la section muette.
    const granted = page.locator('.settings__ok');
    const denied = page.locator('.settings__alert');
    const ask = page.getByRole('button', { name: /Autoriser les notifications/ });

    await expect(granted.or(denied).or(ask).first()).toBeVisible();
  });

  /*
   * Une case a cocher qui ne coche rien est pire que pas de reglage : on croit
   * avoir agi. Ce test verifie qu'un interrupteur atteint bien la page, et
   * qu'il survit a un rechargement.
   */
  test('un interrupteur d accessibilite agit vraiment, et tient au rechargement', async ({
    page,
  }) => {
    await openSettings(page);
    await nav(page).getByRole('button', { name: 'Accessibilite' }).click();

    const racine = page.locator('html');
    await expect(racine).toHaveAttribute('data-underline-links', 'off');

    await page.getByText('Souligner les liens').click();
    await expect(racine).toHaveAttribute('data-underline-links', 'on');

    await page.reload();
    await expect(racine).toHaveAttribute('data-underline-links', 'on');

    // On repart d'un etat propre : le reglage est enregistre pour ce compte.
    await page.getByRole('button', { name: 'Preferences' }).click();
    await nav(page).getByRole('button', { name: 'Accessibilite' }).click();
    await page.getByText('Souligner les liens').click();
    await expect(racine).toHaveAttribute('data-underline-links', 'off');
  });

  test('la page Discussion regroupe ses reglages sous des intitules', async ({ page }) => {
    await openSettings(page);
    await nav(page).getByRole('button', { name: 'Discussion' }).click();

    for (const titre of ['Affichage des messages', 'Ecriture', 'Images animees']) {
      await expect(page.getByRole('heading', { level: 2, name: titre })).toBeVisible();
    }
  });

  /*
   * Passer d'une boite a une autre.
   *
   * `dialog.close()` emet `close` sans dire qui l'a demande : en ouvrant
   * l'editeur depuis la fiche, la fermeture de la fiche remettait l'etat a
   * « aucune boite » et l'editeur disparaissait aussitot. Les boutons
   * paraissaient morts. Le chemin complet est verifie ici, dans les deux sens.
   */
  test('ouvrir l editeur depuis la fiche de profil ne referme pas tout', async ({ page }) => {
    await openSettings(page);

    await page.getByRole('button', { name: 'Voir ma fiche' }).click();
    const fiche = page.getByRole('dialog', { name: 'Profil', exact: true });
    await expect(fiche).toBeVisible();

    await fiche.getByRole('button', { name: 'Modifier mon profil' }).click();

    const editeur = page.getByRole('dialog', { name: 'Mon profil', exact: true });
    await expect(editeur).toBeVisible();
    await expect(fiche).toBeHidden();

    // Le pseudo se change ici : il etait annonce comme fixe alors que la
    // fonction existait deja.
    await expect(editeur.getByLabel('Pseudo')).toBeVisible();
    await expect(
      editeur.getByRole('button', { name: 'Changer la banniere', exact: true }),
    ).toBeVisible();
    await expect(
      editeur.getByRole('button', { name: 'Changer la photo', exact: true }),
    ).toBeVisible();

    await editeur.getByRole('button', { name: 'Annuler' }).click();
    await expect(editeur).toBeHidden();
  });

  test('la photo du compte reste ronde', async ({ page }) => {
    await openSettings(page);

    const avatar = page.locator('.account__head .avatar');
    await expect(avatar).toBeVisible();

    // Comprime en largeur par la ligne qui la contenait, elle devenait un
    // ovale : la hauteur tenait, la largeur non.
    const boite = await avatar.boundingBox();
    expect(boite).not.toBeNull();
    expect(Math.abs((boite?.width ?? 0) - (boite?.height ?? 0))).toBeLessThan(2);

    /*
     * La pastille d'etat reste dans le cadre.
     *
     * Elle debordait de cinq pixels en bas a droite : la silhouette de
     * l'ensemble se lisait comme un oeuf, et c'est ce qu'on prenait pour un
     * avatar ovale. Le cadre etant rond au pixel, c'est ce depassement qu'il
     * faut retenir.
     */
    const dot = avatar.locator('.avatar__status');
    const pastille = (await dot.count()) > 0 ? await dot.boundingBox() : null;
    if (pastille && boite) {
      expect(pastille.x + pastille.width).toBeLessThanOrEqual(boite.x + boite.width + 1);
      expect(pastille.y + pastille.height).toBeLessThanOrEqual(boite.y + boite.height + 1);
    }
  });
});
