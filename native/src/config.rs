//! Adresse du projet Supabase et cle publiable.
//!
//! Lues a l'execution plutot que figees a la compilation : le meme binaire doit
//! pouvoir viser un projet de test puis celui de production sans etre
//! recompile. La cle publiable est faite pour etre distribuee — ce qui protege
//! les donnees, ce sont les politiques RLS de la base, pas son secret.

use std::path::PathBuf;

pub struct Config {
    pub url: String,
    pub key: String,
}

/// Retire les guillemets qu'on met par reflexe dans un fichier de configuration.
fn nettoyer(valeur: &str) -> String {
    valeur.trim().trim_matches(['"', '\'']).to_string()
}

/// Cherche un fichier `.env` en remontant depuis le dossier courant.
///
/// Remonter permet de lancer `cargo run` depuis `native/` tout en lisant le
/// `.env.local` a la racine du depot, sans le dupliquer — deux copies
/// finiraient par diverger.
fn trouver_env() -> Option<PathBuf> {
    let mut dossier = std::env::current_dir().ok()?;

    for _ in 0..4 {
        for nom in [".env.local", ".env"] {
            let chemin = dossier.join(nom);
            if chemin.is_file() {
                return Some(chemin);
            }
        }
        if !dossier.pop() {
            break;
        }
    }
    None
}

impl Config {
    /// Charge la configuration, en donnant la priorite a l'environnement.
    pub fn charger() -> Result<Self, String> {
        let mut url = std::env::var("VITE_SUPABASE_URL").ok();
        let mut key = std::env::var("VITE_SUPABASE_PUBLISHABLE_KEY").ok();

        if url.is_none() || key.is_none() {
            if let Some(chemin) = trouver_env() {
                if let Ok(contenu) = std::fs::read_to_string(&chemin) {
                    for ligne in contenu.lines() {
                        let ligne = ligne.trim();
                        if ligne.is_empty() || ligne.starts_with('#') {
                            continue;
                        }
                        let Some((cle, valeur)) = ligne.split_once('=') else {
                            continue;
                        };
                        match cle.trim() {
                            "VITE_SUPABASE_URL" if url.is_none() => {
                                url = Some(nettoyer(valeur));
                            }
                            "VITE_SUPABASE_PUBLISHABLE_KEY" if key.is_none() => {
                                key = Some(nettoyer(valeur));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        match (url, key) {
            (Some(u), Some(k)) if !u.is_empty() && !k.is_empty() => {
                Ok(Self { url: u, key: k })
            }
            _ => Err(
                "Configuration Supabase introuvable. Renseignez VITE_SUPABASE_URL \
                 et VITE_SUPABASE_PUBLISHABLE_KEY, dans l'environnement ou dans \
                 un fichier .env.local."
                    .to_string(),
            ),
        }
    }
}

/// Dossier ou ranger la session ouverte.
///
/// Les conventions du systeme plutot qu'un dossier a cote du binaire : celui-ci
/// peut vivre dans `Program Files`, ou l'application n'a pas le droit d'ecrire.
pub fn dossier_donnees() -> Option<PathBuf> {
    directories::ProjectDirs::from("app", "orbit", "Orbit")
        .map(|d| d.data_dir().to_path_buf())
}
