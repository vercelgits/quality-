import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Charge les identifiants du compte de test depuis `.env.e2e`, s'il existe.
 *
 * Un fichier plutot que des variables a retaper a chaque commande : le mot de
 * passe reste sur la machine, hors du depot et hors de l'historique du terminal.
 * Le fichier est ignore par git.
 */
function loadTestCredentials(): void {
  let raw: string;
  try {
    raw = readFileSync(new URL('.env.e2e', import.meta.url), 'utf8');
  } catch {
    return; // Absent : les parcours authentifies se declareront ignores.
  }

  // Coupe sur le saut de ligne seul ; `trim` se charge du retour chariot que
  // Windows ajoute, ce qui evite d'avoir a le prevoir ici.
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
 * Configuration Playwright.
 *
 * Deux familles de tests coexistent :
 *
 *  - `public` : tout ce qui s'observe sans compte — ecran de connexion,
 *    validation des formulaires, accessibilite, adaptation aux petits ecrans.
 *    Ces tests tournent toujours, y compris en integration continue.
 *
 *  - `authenticated` : les parcours qui demandent une session. Ils lisent
 *    `E2E_EMAIL` et `E2E_PASSWORD` dans l'environnement et se declarent ignores
 *    si ces variables manquent, plutot que d'echouer. Un identifiant de test ne
 *    doit jamais vivre dans le depot.
 *
 * Le serveur de developpement est demarre par Playwright lui-meme, et reutilise
 * s'il tourne deja : sans cela, lancer les tests pendant qu'on developpe
 * echouerait sur un port occupe.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    // Trace et capture uniquement au premier echec : les conserver a chaque
    // execution remplirait le disque pour rien.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Les specs mobiles ont leur propre projet : les executer ici aussi
      // les ferait echouer sur un viewport de bureau.
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /.*\.mobile\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
