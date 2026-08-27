import { test, expect } from '@playwright/test';
import { signIn, uniqueText, withoutCredentials, skipReason } from './session';

/** Parcours critiques avec une session ouverte. */

test.describe('Parcours authentifies', () => {
  test.skip(withoutCredentials, skipReason);

  test('se connecte et atteint un salon', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('button', { name: 'Messages prives' })).toBeVisible();
    await expect(page.locator('.composer__input')).toBeVisible();
  });

  test('envoie un message et le voit apparaitre', async ({ page }) => {
    await signIn(page);

    const text = uniqueText('Test envoi');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');

    await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });
    // Le compositeur se vide : sans cela on renverrait le meme texte au clic suivant.
    await expect(page.locator('.composer__input')).toHaveValue('');
  });

  test('modifie un message deja envoye', async ({ page }) => {
    await signIn(page);

    const original = uniqueText('Avant modification');
    await page.locator('.composer__input').fill(original);
    await page.keyboard.press('Enter');
    await expect(page.getByText(original)).toBeVisible({ timeout: 10_000 });

    const message = page.locator('.message', { hasText: original }).last();
    await message.hover();
    await message.getByRole('button', { name: 'Modifier' }).click();

    const editor = message.locator('.message__editor-input');
    await editor.fill(`${original} — corrige`);
    await editor.press('Enter');

    await expect(page.getByText(`${original} — corrige`)).toBeVisible();
    await expect(page.getByText('(modifie)').last()).toBeVisible();
  });

  test('ajoute une reaction puis la retire', async ({ page }) => {
    await signIn(page);

    const text = uniqueText('Test reaction');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });

    const message = page.locator('.message', { hasText: text }).last();
    await message.hover();
    await message.getByRole('button', { name: 'Reagir avec 👍' }).click();

    const reaction = message.locator('.reaction', { hasText: '👍' });
    await expect(reaction).toBeVisible();
    await expect(reaction).toHaveAttribute('aria-pressed', 'true');

    await reaction.click();
    await expect(reaction).toHaveCount(0);
  });

  test('supprime un message', async ({ page }) => {
    await signIn(page);

    const text = uniqueText('A supprimer');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });

    const message = page.locator('.message', { hasText: text }).last();
    await message.hover();
    await message.getByRole('button', { name: 'Supprimer' }).click();

    await expect(page.getByText(text)).toHaveCount(0);
  });

  test('ouvre un fil depuis un message', async ({ page }) => {
    await signIn(page);

    const text = uniqueText('Question a suivre');
    await page.locator('.composer__input').fill(text);
    await page.keyboard.press('Enter');
    await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });

    const message = page.locator('.message', { hasText: text }).last();
    await message.hover();
    await message.getByRole('button', { name: 'Ouvrir un fil' }).click();

    // Le panneau lateral s'ouvre sur le fil qui vient d'etre cree.
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Marquer resolu' })).toBeVisible();
  });

  test('la palette de commandes s ouvre et ferme au clavier', async ({ page }) => {
    await signIn(page);

    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Palette de commandes' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Palette de commandes' })).toHaveCount(0);
  });

  test('la recherche trouve un message qui vient d etre ecrit', async ({ page }) => {
    await signIn(page);

    const needle = `sentinelle${Date.now().toString(36)}`;
    await page.locator('.composer__input').fill(`Message contenant ${needle}`);
    await page.keyboard.press('Enter');
    await expect(page.getByText(needle)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Control+f');
    await page.getByLabel('Rechercher dans les messages').fill(needle);

    await expect(page.locator('.search-hit').first()).toBeVisible({ timeout: 15_000 });
  });

  test('le lien d evitement mene a la conversation', async ({ page }) => {
    await signIn(page);

    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Aller a la conversation' });
    await expect(skip).toBeFocused();

    // La cible doit exister, sinon le lien ne mene nulle part.
    await expect(page.locator('#conversation')).toBeAttached();
  });

  test('bascule vers les messages prives', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Messages prives' }).click();

    await expect(page.getByRole('heading', { name: 'Messages prives' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Nouvelle conversation' }).first(),
    ).toBeVisible();
  });
});
