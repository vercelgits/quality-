//! Verifie que la connexion aboutit reellement contre le projet Supabase.
//!
//! Les identifiants viennent de `.env.e2e`, le meme fichier que la suite
//! Playwright, et ne sont jamais ecrits ici. Sans eux, le test se declare reussi
//! sans rien tenter plutot que d'echouer : un depot fraichement clone doit
//! pouvoir lancer `cargo test` sans configuration.

use std::path::PathBuf;

/// Lit une variable dans `.env.e2e`, en remontant depuis le dossier courant.
fn depuis_env_e2e(cle: &str) -> Option<String> {
    if let Ok(valeur) = std::env::var(cle) {
        if !valeur.is_empty() {
            return Some(valeur);
        }
    }

    let mut dossier: PathBuf = std::env::current_dir().ok()?;
    for _ in 0..4 {
        let chemin = dossier.join(".env.e2e");
        if chemin.is_file() {
            let contenu = std::fs::read_to_string(&chemin).ok()?;
            for ligne in contenu.lines() {
                let ligne = ligne.trim();
                if ligne.is_empty() || ligne.starts_with('#') {
                    continue;
                }
                if let Some((nom, valeur)) = ligne.split_once('=') {
                    if nom.trim() == cle {
                        let valeur = valeur.trim().trim_matches(['"', '\'']);
                        if !valeur.is_empty() {
                            return Some(valeur.to_string());
                        }
                    }
                }
            }
        }
        if !dossier.pop() {
            break;
        }
    }
    None
}

#[test]
fn connexion_puis_profil() {
    let (Some(email), Some(mot_de_passe)) = (
        depuis_env_e2e("E2E_EMAIL"),
        depuis_env_e2e("E2E_PASSWORD"),
    ) else {
        eprintln!("ignore : E2E_EMAIL et E2E_PASSWORD absents");
        return;
    };

    let config = orbit_natif::config::Config::charger().expect("configuration Supabase");
    let client = orbit_natif::api::Client::nouveau(config).expect("client HTTP");

    let session = client
        .connexion(&email, &mot_de_passe)
        .expect("la connexion doit aboutir");

    assert!(!session.access_token.is_empty(), "jeton d'acces vide");
    assert!(!session.refresh_token.is_empty(), "jeton de rafraichissement vide");
    assert!(!session.user.id.is_empty(), "identifiant utilisateur vide");

    // Le profil passe par PostgREST et par les politiques RLS : le lire prouve
    // que le jeton est accepte au-dela de l'authentification elle-meme.
    let profil = client.profil(&session).expect("le profil doit etre lisible");
    assert!(!profil.username.is_empty(), "pseudo vide");

    // Le rafraichissement est ce qui evite de redemander le mot de passe a
    // chaque lancement : il merite d'etre verifie, pas suppose.
    let renouvelee = client
        .rafraichir(&session.refresh_token)
        .expect("le rafraichissement doit aboutir");
    assert!(!renouvelee.access_token.is_empty(), "jeton renouvele vide");

    eprintln!("connexion, profil et rafraichissement : verifies");
}

#[test]
fn identifiants_faux_donnent_une_phrase_lisible() {
    let Ok(config) = orbit_natif::config::Config::charger() else {
        eprintln!("ignore : configuration Supabase absente");
        return;
    };
    let client = orbit_natif::api::Client::nouveau(config).expect("client HTTP");

    let erreur = client
        .connexion("personne-inexistante@exemple.invalid", "mauvais-mot-de-passe")
        .expect_err("des identifiants faux doivent etre refuses");

    // Ni code technique, ni anglais brut : c'est ce que la personne lira.
    assert!(
        !erreur.to_lowercase().contains("invalid login credentials"),
        "message non traduit : {erreur}"
    );
    assert!(erreur.len() > 8, "message trop court : {erreur}");

    eprintln!("refus annonce : {erreur}");
}
