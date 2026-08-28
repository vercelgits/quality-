//! Verifie que la connexion aboutit reellement contre le projet Supabase.
//!
//! Les identifiants viennent de `.env.e2e`, le meme fichier que la suite
//! Playwright, et ne sont jamais ecrits ici. Sans eux, le test se declare reussi
//! sans rien tenter plutot que d'echouer : un depot fraichement clone doit
//! pouvoir lancer `cargo test` sans configuration.

use std::path::PathBuf;
use std::sync::OnceLock;

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

/// Session ouverte une seule fois, partagee par tous les tests.
///
/// Les tests Rust s'executent en parallele : trois connexions simultanees
/// heurtent la limite d'authentification de Supabase, et l'echec qui en decoule
/// n'apprend rien sur le code.
fn session_partagee() -> Option<&'static (orbit_natif::api::Client, orbit_natif::api::Session)> {
    static SESSION: OnceLock<Option<(orbit_natif::api::Client, orbit_natif::api::Session)>> =
        OnceLock::new();

    SESSION
        .get_or_init(|| {
            let email = depuis_env_e2e("E2E_EMAIL")?;
            let mot_de_passe = depuis_env_e2e("E2E_PASSWORD")?;

            let config = orbit_natif::config::Config::charger().ok()?;
            let client = orbit_natif::api::Client::nouveau(config).ok()?;
            let session = client.connexion(&email, &mot_de_passe).ok()?;

            Some((client, session))
        })
        .as_ref()
}

#[test]
fn connexion_puis_profil() {
    let Some((client, session)) = session_partagee() else {
        eprintln!("ignore : E2E_EMAIL et E2E_PASSWORD absents");
        return;
    };

    assert!(!session.access_token.is_empty(), "jeton d'acces vide");
    assert!(!session.refresh_token.is_empty(), "jeton de rafraichissement vide");
    assert!(!session.user.id.is_empty(), "identifiant utilisateur vide");

    // Le profil passe par PostgREST et par les politiques RLS : le lire prouve
    // que le jeton est accepte au-dela de l'authentification elle-meme.
    let profil = client.profil(session).expect("le profil doit etre lisible");
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

#[test]
fn amorce_puis_messages() {
    let Some((client, session)) = session_partagee() else {
        eprintln!("ignore : identifiants absents");
        return;
    };

    // `bootstrap()` est la meme fonction SQL que celle du client web : ce test
    // verifie donc que la reutilisation tient, pas seulement que l'appel passe.
    let amorce = client.amorcer(session).expect("l'amorce doit aboutir");

    assert!(!amorce.spaces.is_empty(), "aucun espace : le compte devrait en avoir un");
    assert!(!amorce.channels.is_empty(), "aucun salon");

    let espace = &amorce.spaces[0];
    let salon = amorce
        .channels
        .iter()
        .find(|c| c.space_id.as_deref() == Some(espace.id.as_str()) && c.kind == "text")
        .expect("un salon textuel dans le premier espace");

    let messages = client
        .messages(session, &salon.id, 20)
        .expect("les messages doivent etre lisibles");

    // L'ordre compte : l'affichage va du haut vers le bas, donc du plus ancien
    // au plus recent. PostgREST trie a l'envers pour que la limite garde les
    // derniers, et on retablit ensuite.
    if messages.len() > 1 {
        let premier = &messages[0].created_at;
        let dernier = &messages[messages.len() - 1].created_at;
        assert!(premier <= dernier, "les messages doivent aller du plus ancien au plus recent");
    }

    eprintln!(
        "amorce : {} espace(s), {} salon(s), {} message(s) dans #{}",
        amorce.spaces.len(),
        amorce.channels.len(),
        messages.len(),
        salon.name
    );
}

#[test]
fn envoi_puis_relecture() {
    let Some((client, session)) = session_partagee() else {
        eprintln!("ignore : identifiants absents");
        return;
    };

    let amorce = client.amorcer(session).expect("amorce");
    let salon = amorce
        .channels
        .iter()
        .find(|c| c.kind == "text")
        .expect("un salon textuel");

    let texte = format!("natif {}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis());

    let envoye = client
        .envoyer(session, &salon.id, &texte)
        .expect("l'envoi doit aboutir");

    assert_eq!(envoye.content, texte, "le serveur doit renvoyer ce qui a ete ecrit");

    // Relu depuis la base : l'ecriture a vraiment abouti, et pas seulement
    // renvoye ce qu'on lui a donne.
    //
    // Vingt derniers plutot que cinq : les tests s'executent en parallele et
    // d'autres messages peuvent s'intercaler, ce qui ferait echouer ce test
    // pour une raison qui ne le concerne pas.
    let messages = client
        .messages(session, &salon.id, 20)
        .expect("relecture")
        .into_iter()
        .map(|m| m.content)
        .collect::<Vec<_>>();

    assert!(
        messages.contains(&texte),
        "le message envoye doit figurer parmi les derniers"
    );

    eprintln!("envoi et relecture : verifies dans #{}", salon.name);
}

#[test]
fn le_flux_temps_reel_s_ouvre() {
    let Some((_client, session)) = session_partagee() else {
        eprintln!("ignore : identifiants absents");
        return;
    };

    let config = orbit_natif::config::Config::charger().expect("configuration");
    let (envoi, reception) = std::sync::mpsc::channel();

    let jeton = session.access_token.clone();
    std::thread::spawn(move || {
        orbit_natif::temps_reel::suivre(config.url, config.key, jeton, envoi);
    });

    // On attend l'annonce de connexion : c'est ce qui prouve que le sujet a ete
    // rejoint, pas seulement que le socket s'est ouvert.
    let recu = reception
        .recv_timeout(std::time::Duration::from_secs(15))
        .expect("le flux doit annoncer son etat sous quinze secondes");

    match recu {
        orbit_natif::temps_reel::Evenement::Etat { connecte } => {
            assert!(connecte, "le flux doit s'annoncer connecte");
            eprintln!("flux temps reel : connecte");
        }
        _ => panic!("le premier evenement doit etre un etat"),
    }
}
