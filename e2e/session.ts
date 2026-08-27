import { expect, type Page } from '@playwright/test';

/**
 * Ouverture de session partagee par les parcours authentifies.
 *
 * Ces tests ecrivent dans un vrai projet Supabase : ils demandent un compte
 * dedie, fourni par l'environnement. Sans lui, les suites concernees se
 * declarent ignorees plutot qu'en echec — un identifiant de test n'a rien a
 * faire dans le depot, et un depot fraichement clone doit pouvoir lancer les
 * tests publics sans rien configurer.
 *
 *   E2E_EMAIL=compte-de-test@exemple.fr E2E_PASSWORD=... npx playwright test
 */

export const email = process.env['E2E_EMAIL'];
export const password = process.env['E2E_PASSWORD'];

/** Vrai quand les identifiants manquent : a passer a `test.skip`. */
export const withoutCredentials = !email || !password;

export const skipReason = 'Definissez E2E_EMAIL et E2E_PASSWORD pour executer ces tests.';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email!);
  await page.getByLabel('Mot de passe').fill(password!);
  await page.getByRole('button', { name: 'Entrer' }).click();

  // L'amorcage charge espaces et salons : on attend la barre laterale plutot
  // qu'un delai fixe, qui serait tantot trop court tantot inutilement long.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible({
    timeout: 20_000,
  });
}

/** Texte unique par execution, pour ne jamais confondre deux essais. */
export function uniqueText(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}
