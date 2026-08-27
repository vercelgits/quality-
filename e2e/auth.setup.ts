import { test as setup } from '@playwright/test';
import { signIn, STATE_FILE, withoutCredentials, skipReason } from './session';

/**
 * Ouvre une session une fois pour toutes et l'enregistre sur disque.
 *
 * Les autres projets la rejouent. Sans cela chaque test repasserait par le
 * formulaire, et le nombre de connexions finirait par declencher la limitation
 * de Supabase — des echecs qui ressemblent a des regressions sans en etre.
 */
setup('ouvre une session et la conserve', async ({ page }) => {
  setup.skip(withoutCredentials, skipReason);

  await signIn(page);

  // Les preferences vivent dans le stockage local, donc dans l'etat enregistre.
  // Sans les fixer ici, la suite heriterait de ce que ce compte avait choisi :
  // « Envoyer avec Entree » desactive, par exemple, et l'envoi d'un message ne
  // partirait jamais — un echec qui n'apprendrait rien sur l'application.
  await page.evaluate(() => {
    localStorage.setItem(
      'orbit:preferences',
      JSON.stringify({
        theme: 'dark',
        density: 'cozy',
        accent: 'indigo',
        reduceMotion: false,
        sendOnEnter: true,
        showTimestamps: true,
        animateAvatars: 'hover',
      }),
    );
  });

  await page.context().storageState({ path: STATE_FILE });
});
