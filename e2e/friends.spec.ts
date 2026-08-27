import { test, expect } from '@playwright/test';
import { openApp, withoutCredentials, skipReason } from './session';

/**
 * Page des amis.
 *
 * Les parcours qui demandent deux personnes — accepter une demande, ecrire a un
 * ami — ne sont pas couverts ici : ils exigeraient un second compte, donc un
 * second identifiant dans l'environnement. Ce qui est verifie, c'est tout ce
 * qu'une seule session permet d'observer, y compris le refus d'une demande
 * adressee a un pseudo inexistant, qui passe bien par la base.
 */

test.describe('Amis', () => {
  test.skip(withoutCredentials, skipReason);

  async function openFriends(page: import('@playwright/test').Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Messages prives' }).click();
    await expect(page.getByRole('tablist', { name: /Listes d.amis/ })).toBeVisible({
      timeout: 15_000,
    });

    // Sans la migration des amis, la page s'affiche mais toutes les listes
    // restent vides : les tests passeraient sans rien prouver. Se declarer
    // ignore dit la verite ; passer serait un mensonge.
    //
    // L'erreur arrive apres la barre d'onglets, le chargement etant lance au
    // montage : la chercher immediatement ne la trouverait jamais.
    const failure = page.locator('.friends__error');
    await failure.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {
      // Aucune erreur : la migration est en place.
    });

    if (await failure.isVisible().catch(() => false)) {
      const text = (await failure.textContent()) ?? '';
      // Le message reste lisible meme dans ce cas : c'est verifiable ici.
      expect(text).not.toMatch(/schema cache|PGRST|could not find/i);
      test.skip(true, 'Migration des amis non appliquee sur ce projet Supabase.');
    }
  }

  test('le bouton des messages prives ouvre la page des amis', async ({ page }) => {
    await openFriends(page);

    await expect(page.getByRole('tab', { name: 'En ligne' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('searchbox', { name: 'Rechercher un ami' })).toBeVisible();
  });

  test('chaque onglet montre sa propre liste', async ({ page }) => {
    await openFriends(page);

    for (const label of ['Tous', 'En attente', 'Bloques']) {
      await page.getByRole('tab', { name: label }).click();
      await expect(page.getByRole('tab', { name: label })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      // Une liste vide affiche un etat vide qui explique quoi faire, jamais une
      // zone blanche.
      const populated = (await page.locator('.friends__row').count()) > 0;
      if (!populated) {
        await expect(page.locator('.friends__empty p')).not.toBeEmpty();
      }
    }
  });

  test('la recherche filtre sans jamais laisser la zone vide sans explication', async ({
    page,
  }) => {
    await openFriends(page);
    await page.getByRole('tab', { name: 'Tous' }).click();

    await page
      .getByRole('searchbox', { name: 'Rechercher un ami' })
      .fill('zzz-personne-ne-porte-ce-nom');

    // Soit il reste des lignes, soit un etat vide prend le relais.
    await expect(page.locator('.friends__row, .friends__empty')).not.toHaveCount(0);
  });

  test('une demande vers un pseudo inconnu est refusee lisiblement', async ({ page }) => {
    await openFriends(page);

    await page.getByRole('tab', { name: 'Ajouter un ami' }).click();
    await page.getByLabel(/Pseudo de la personne/).fill('pseudo-inexistant-xyz');
    await page.getByRole('button', { name: 'Envoyer la demande' }).click();

    const message = page.locator('.addfriend__error');
    await expect(message).toBeVisible({ timeout: 10_000 });
    await expect(message).not.toContainText(/PGRST|P0002|22023/);
  });

  test('on ne peut pas s ajouter soi-meme', async ({ page }) => {
    await openFriends(page);
    await page.getByRole('tab', { name: 'Ajouter un ami' }).click();

    // Son propre pseudo est rappele sur la page : on le reprend tel quel.
    const mine = (await page.locator('.addfriend__share-value').textContent()) ?? '';
    const username = mine.replace('@', '').trim();

    if (username === '') {
      test.skip(true, 'Pseudo introuvable sur la page.');
      return;
    }

    await page.getByLabel(/Pseudo de la personne/).fill(username);
    await page.getByRole('button', { name: 'Envoyer la demande' }).click();

    await expect(page.locator('.addfriend__error')).toBeVisible({ timeout: 10_000 });
  });

  test('choisir une conversation quitte la page des amis', async ({ page }) => {
    await openFriends(page);

    const conversation = page.locator('.dm-item').first();
    if ((await conversation.count()) === 0) {
      test.skip(true, 'Aucune conversation privee sur ce compte.');
      return;
    }

    await conversation.click();
    await expect(page.getByRole('tablist', { name: /Listes d.amis/ })).toBeHidden();
  });
});
