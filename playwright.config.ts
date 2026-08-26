import { defineConfig, devices } from '@playwright/test';

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
