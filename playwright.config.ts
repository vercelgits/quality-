import { defineConfig, devices } from '@playwright/test';
import { STATE_FILE } from './e2e/session';

export default defineConfig({
  testDir: './e2e',
  // Les fichiers s'executent en parallele, mais les tests d'un meme fichier se
  // suivent : ceux d'une meme suite ecrivent dans le meme salon avec le meme
  // compte, et se genaient mutuellement — un message supprime pendant qu'un
  // autre test recharge la liste produisait des echecs sans rapport avec le
  // code.
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    // Trace et capture uniquement au premier echec : les conserver a chaque
    // execution remplirait le disque pour rien.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    // Ouvre la session une fois et l'enregistre ; les projets authentifies la
    // rejouent au lieu de repasser par le formulaire.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'public',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(landing|auth)\.spec\.ts/,
    },
    {
      name: 'authentifie',
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILE },
      dependencies: ['setup'],
      testMatch: /(messaging|spaces|friends|settings|voice)\.spec\.ts/,
    },

    {
      name: 'mobile-public',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.mobile\.spec\.ts/,
    },
    {
      name: 'mobile-authentifie',
      use: { ...devices['Pixel 7'], storageState: STATE_FILE },
      dependencies: ['setup'],
      testMatch: /drawer\.mobile\.spec\.ts/,
    },
  ],

  /*
   * Les tests visent l'application construite, pas le serveur de
   * developpement.
   *
   * En developpement, Vite sert chaque module separement : le premier
   * chargement demande des centaines de requetes, et plusieurs navigateurs en
   * parallele le font depasser trente secondes. Les echecs qui en decoulent ne
   * disent rien de l'application.
   *
   * La version construite est aussi celle qui est livree : la tester est plus
   * juste que de tester un assemblage qui n'existe qu'ici.
   */
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
