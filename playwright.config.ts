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

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
