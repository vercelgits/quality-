import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Charge `.env.e2e` avant toute lecture de l'environnement.
 *
 * L'appel vit ici et non dans la configuration : les imports d'un module sont
 * evalues avant son corps, si bien qu'un chargement place dans la configuration
 * arrivait apres la lecture faite par ce fichier — et tous les parcours
 * authentifies se declaraient ignores.
 */
function loadTestCredentials(): void {
  let raw: string;
  try {
    raw = readFileSync(new URL('../.env.e2e', import.meta.url), 'utf8');
  } catch {
    return; // Absent : les parcours authentifies se declareront ignores.
  }

  const NEWLINE = String.fromCharCode(10);

  for (const line of raw.split(NEWLINE)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    // Les guillemets sont retires : on en met par reflexe autour d'un mot de
    // passe, et ils partiraient sinon tels quels dans le formulaire.
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    // L'environnement reel garde la priorite : une commande explicite doit
    // pouvoir surcharger le fichier.
    if (value !== '' && process.env[key] === undefined) process.env[key] = value;
  }
}

loadTestCredentials();

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

  await passOnboarding(page);

  // L'amorcage charge espaces et salons : on attend la barre laterale plutot
  // qu'un delai fixe, qui serait tantot trop court tantot inutilement long.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Franchit l'ecran de choix du pseudo, s'il se presente.
 *
 * Un compte cree depuis le tableau de bord Supabase n'a pas choisi son pseudo :
 * la base en deduit un de l'adresse et l'application demande de trancher avant
 * d'entrer. Sans ce passage, chaque parcours authentifie echouerait sur un
 * compte neuf — et l'echec designerait la barre laterale manquante plutot que
 * sa vraie cause.
 */
async function passOnboarding(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: /Choisissez votre pseudo/i });

  // Course volontaire : sur un compte deja configure, l'ecran ne parait jamais
  // et c'est la barre laterale qui gagne.
  const outcome = await Promise.race([
    heading.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'onboarding' as const),
    page
      .getByRole('navigation', { name: 'Navigation principale' })
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'ready' as const),
  ]).catch(() => 'ready' as const);

  if (outcome !== 'onboarding') return;

  // Le pseudo propose est deja libre : le valider tel quel suffit.
  const submit = page.getByRole('button', { name: 'Continuer' });
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
}

/** Texte unique par execution, pour ne jamais confondre deux essais. */
export function uniqueText(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

/** Session enregistree par le projet d'amorcage, rejouee par les autres. */
export const STATE_FILE = 'playwright/.auth/user.json';

/**
 * Ouvre l'application avec la session deja etablie.
 *
 * Les parcours authentifies rejouent l'etat enregistre au lieu de repasser par
 * le formulaire : une cinquantaine de connexions en quelques secondes finit par
 * se heurter aux limites d'authentification de Supabase, et les echecs qui en
 * decoulent n'apprennent rien sur l'application.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible({
    timeout: 20_000,
  });

  // Le rail parait avant que le salon par defaut soit choisi : agir a ce
  // moment-la revient a taper dans un compositeur qui n'existe pas encore.
  // On attend donc l'un des etats stables de la zone principale.
  await expect(
    page
      .locator('.composer__input')
      .or(page.locator('.voice-stage'))
      .or(page.locator('.friends'))
      .or(page.locator('.main__empty'))
      .first(),
  ).toBeVisible({ timeout: 20_000 });
}
