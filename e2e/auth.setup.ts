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
  await page.context().storageState({ path: STATE_FILE });
});
