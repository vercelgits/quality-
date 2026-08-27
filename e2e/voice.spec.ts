import { test, expect, type Page } from '@playwright/test';
import { openApp, withoutCredentials, skipReason } from './session';

/**
 * Salon vocal.
 *
 * Le navigateur recoit un micro et une camera factices : sans eux, la demande
 * d'autorisation ouvrirait une fenetre systeme que Playwright ne peut pas
 * fermer, et l'entree en vocal echouerait pour une raison sans rapport avec le
 * code teste.
 *
 * Ce qui est verifie, c'est l'etat de l'interface d'un seul cote : la
 * negociation entre deux pairs demanderait deux sessions simultanees et un
 * second compte.
 */

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
  permissions: ['microphone', 'camera'],
});

/**
 * Commandes de la scene vocale.
 *
 * La barre laterale porte les memes boutons — micro, casque — pour l'appel en
 * cours ou qu'il se trouve. Sans cette delimitation, chaque assertion
 * designerait deux elements, ou pire, le mauvais.
 */
function stage(page: Page) {
  return page.locator('.voice-stage');
}

test.describe('Salon vocal', () => {
  test.skip(withoutCredentials, skipReason);

  /** Ouvre un salon vocal, ou declare le test ignore s'il n'y en a pas. */
  async function openVoiceChannel(page: import('@playwright/test').Page): Promise<boolean> {
    await openApp(page);

    const voiceChannel = page.locator('.channel[data-kind="voice"]').first();
    if ((await voiceChannel.count()) === 0) {
      test.skip(true, 'Aucun salon vocal sur ce compte.');
      return false;
    }

    await voiceChannel.click();

    // Le bouton n'est actif qu'une fois le profil charge : cliquer avant
    // n'aurait aucun effet, et le test attendrait un etat qui ne vient pas.
    await expect(page.getByRole('button', { name: 'Rejoindre le salon vocal' })).toBeEnabled({
      timeout: 15_000,
    });
    return true;
  }

  test('affiche l invitation a rejoindre avant toute connexion', async ({ page }) => {
    if (!(await openVoiceChannel(page))) return;

    // La scene n'offre aucune commande de micro tant qu'on n'est pas entre :
    // les afficher laisserait croire qu'on est deja en ligne.
    await expect(stage(page).getByRole('button', { name: /Couper le micro/ })).toHaveCount(0);
  });

  test('rejoint, coupe le micro, coupe le son, puis quitte', async ({ page }) => {
    if (!(await openVoiceChannel(page))) return;

    await page.getByRole('button', { name: 'Rejoindre le salon vocal' }).click();

    const mute = stage(page).getByRole('button', { name: 'Couper le micro' });
    await expect(mute).toBeVisible({ timeout: 20_000 });

    await mute.click();
    await expect(stage(page).getByRole('button', { name: 'Reactiver le micro' })).toBeVisible();

    const deafen = stage(page).getByRole('button', { name: 'Couper le son' });
    await deafen.click();
    await expect(stage(page).getByRole('button', { name: 'Reactiver le son' })).toBeVisible();

    await stage(page).getByRole('button', { name: /Quitter/ }).first().click();
    await expect(page.getByRole('button', { name: 'Rejoindre le salon vocal' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('les reglages de peripheriques listent au moins une entree', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Voix et video' }).click();

    // L'invite d'autorisation ne parait que si les noms manquent encore ; avec
    // un peripherique factice deja autorise, elle peut ne jamais s'afficher.
    const allow = page.getByRole('button', { name: /Autoriser et afficher mes appareils/ });
    if (await allow.isVisible().catch(() => false)) {
      await allow.click({ timeout: 10_000 }).catch(() => {
        // Disparue entre-temps : les noms sont arrives seuls.
      });
    }

    const microphones = page.getByLabel(/Peripherique d.entree/);
    await expect(microphones).toBeVisible();
    await expect
      .poll(async () => (await microphones.locator('option').count()), { timeout: 15_000 })
      .toBeGreaterThan(1);
  });

  test('le test du micro demarre et s arrete', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Voix et video' }).click();

    await page.getByRole('button', { name: 'Verifions' }).click();
    await expect(page.getByRole('button', { name: 'Arreter le test' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Arreter le test' }).click();
    await expect(page.getByRole('button', { name: 'Verifions' })).toBeVisible();
  });
});
