// Orbit — client natif.
//
// Aucun moteur web : l'interface est decrite en Slint et rendue directement par
// le systeme. Voir native/README.md pour ce qui est fait et ce qui reste.
//
// Les appels reseau vivent dans des fils separes et reviennent a l'interface
// par `upgrade_in_event_loop`. Les faire dans la boucle d'evenements figerait la
// fenetre pendant chaque requete — et une connexion lente durerait plusieurs
// secondes.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod config;

use std::rc::Rc;
use std::sync::{Arc, Mutex};

slint::include_modules!();

/// Ce que l'application retient d'une session ouverte.
///
/// Partage entre la boucle d'interface et les fils de travail, d'ou le verrou.
#[derive(Default)]
struct Etat {
    session: Option<api::Session>,
}

fn main() -> Result<(), slint::PlatformError> {
    let fenetre = Coquille::new()?;

    // Sans configuration, rien ne peut aboutir : on le dit tout de suite plutot
    // que de laisser echouer la premiere connexion sur un message obscur.
    let client = match config::Config::charger().and_then(api::Client::nouveau) {
        Ok(client) => Some(Rc::new(client)),
        Err(message) => {
            fenetre.set_erreur(message.into());
            None
        }
    };

    let etat = Arc::new(Mutex::new(Etat::default()));

    brancher_fenetre(&fenetre);

    if let Some(client) = client {
        brancher_connexion(&fenetre, Arc::new(client), Arc::clone(&etat));
    }

    fenetre.run()
}

/// Boutons de la barre de titre.
fn brancher_fenetre(fenetre: &Coquille) {
    let faible = fenetre.as_weak();
    fenetre.on_fermer(move || {
        if let Some(f) = faible.upgrade() {
            let _ = f.window().hide();
        }
    });

    let faible = fenetre.as_weak();
    fenetre.on_reduire(move || {
        if let Some(f) = faible.upgrade() {
            f.window().set_minimized(true);
        }
    });

    let faible = fenetre.as_weak();
    fenetre.on_agrandir(move || {
        if let Some(f) = faible.upgrade() {
            let etendue = f.window().is_maximized();
            f.window().set_maximized(!etendue);
        }
    });
}

/// Applique une session ouverte a l'interface, et la conserve.
fn accueillir(
    fenetre: &Coquille,
    etat: &Arc<Mutex<Etat>>,
    session: api::Session,
    profil: api::Profil,
) {
    api::enregistrer_session(&session);

    if let Ok(mut garde) = etat.lock() {
        garde.session = Some(session);
    }

    fenetre.set_nom_affiche(profil.display_name.into());
    fenetre.set_pseudo(format!("@{}", profil.username).into());
    fenetre.set_erreur("".into());
    // Le mot de passe ne doit pas trainer en memoire une fois la session
    // ouverte : il n'a plus aucune raison d'exister.
    fenetre.set_mot_de_passe("".into());
    fenetre.set_occupe(false);
    fenetre.set_connecte(true);
}

fn brancher_connexion(fenetre: &Coquille, client: Arc<Rc<api::Client>>, etat: Arc<Mutex<Etat>>) {
    // `Rc` ne traverse pas les fils : le client est reconstruit dans chaque fil
    // a partir de la configuration, qui est bon marche a relire.
    let _ = client;

    reprendre_session(fenetre, Arc::clone(&etat));

    let faible = fenetre.as_weak();
    let etat_connexion = Arc::clone(&etat);

    fenetre.on_connecter(move || {
        let Some(f) = faible.upgrade() else { return };

        let email = f.get_email().to_string();
        let mot_de_passe = f.get_mot_de_passe().to_string();

        if email.trim().is_empty() || mot_de_passe.is_empty() {
            f.set_erreur("Renseignez votre adresse et votre mot de passe.".into());
            return;
        }

        f.set_occupe(true);
        f.set_erreur("".into());

        let faible_fil = f.as_weak();
        let etat_fil = Arc::clone(&etat_connexion);

        std::thread::spawn(move || {
            let resultat = config::Config::charger()
                .and_then(api::Client::nouveau)
                .and_then(|client| {
                    let session = client.connexion(&email, &mot_de_passe)?;
                    let profil = client.profil(&session)?;
                    Ok((session, profil))
                });

            let _ = faible_fil.upgrade_in_event_loop(move |f| match resultat {
                Ok((session, profil)) => accueillir(&f, &etat_fil, session, profil),
                Err(message) => {
                    f.set_occupe(false);
                    f.set_erreur(message.into());
                }
            });
        });
    });
}

/// Tente de reprendre la session laissee par un lancement precedent.
///
/// Le jeton de rafraichissement est le seul conserve : le jeton d'acces expire
/// en une heure et n'aurait presque jamais de valeur au demarrage suivant.
fn reprendre_session(fenetre: &Coquille, etat: Arc<Mutex<Etat>>) {
    let Some(refresh) = api::session_enregistree() else { return };

    fenetre.set_occupe(true);
    let faible = fenetre.as_weak();

    std::thread::spawn(move || {
        let resultat = config::Config::charger()
            .and_then(api::Client::nouveau)
            .and_then(|client| {
                let session = client.rafraichir(&refresh)?;
                let profil = client.profil(&session)?;
                Ok((session, profil))
            });

        let _ = faible.upgrade_in_event_loop(move |f| match resultat {
            Ok((session, profil)) => accueillir(&f, &etat, session, profil),
            Err(_) => {
                // Un jeton refuse ne se repare pas : on l'efface et on
                // redemande le mot de passe, sans afficher d'erreur — la
                // personne n'a rien fait de mal.
                api::oublier_session();
                f.set_occupe(false);
            }
        });
    });
}
