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

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use slint::{ModelRc, VecModel};

slint::include_modules!();

/// Ce que l'application retient d'une session ouverte.
///
/// Partage entre la boucle d'interface et les fils de travail, d'ou le verrou.
#[derive(Default)]
struct Etat {
    session: Option<api::Session>,
    amorce: Option<api::Amorce>,
    espace_actif: Option<String>,
    salon_actif: Option<String>,
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

    charger_donnees(fenetre, etat);
}

/// Initiales tirees d'un nom, pour la pastille du rail.
fn initiales(nom: &str) -> String {
    nom.split_whitespace()
        .filter_map(|mot| mot.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

/// Heure seule, extraite d'un horodatage ISO.
///
/// Une analyse complete de date demanderait une dependance de plus pour
/// afficher cinq caracteres. La forme est fixe cote serveur.
fn heure(iso: &str) -> String {
    iso.split('T')
        .nth(1)
        .and_then(|reste| reste.get(0..5))
        .unwrap_or("")
        .to_string()
}

/// Va chercher espaces, salons et messages, puis les pose dans l'interface.
fn charger_donnees(fenetre: &Coquille, etat: &Arc<Mutex<Etat>>) {
    let Some(session) = etat.lock().ok().and_then(|g| g.session.clone()) else {
        return;
    };

    let faible = fenetre.as_weak();
    let etat_fil = Arc::clone(etat);

    std::thread::spawn(move || {
        let resultat = config::Config::charger()
            .and_then(api::Client::nouveau)
            .and_then(|client| client.amorcer(&session));

        let _ = faible.upgrade_in_event_loop(move |f| match resultat {
            Ok(amorce) => {
                // Le premier espace et son premier salon textuel sont ouverts
                // d'office : arriver sur une zone vide oblige a chercher quoi
                // cliquer alors qu'il n'y a qu'une chose a faire.
                let espace = amorce.spaces.first().map(|e| e.id.clone());
                let salon = amorce
                    .channels
                    .iter()
                    .find(|c| c.space_id == espace && c.kind == "text")
                    .map(|c| c.id.clone());

                if let Ok(mut garde) = etat_fil.lock() {
                    garde.espace_actif = espace;
                    garde.salon_actif = salon;
                    garde.amorce = Some(amorce);
                }

                rafraichir_vue(&f, &etat_fil);
                charger_messages(&f, &etat_fil);
            }
            Err(message) => f.set_erreur(message.into()),
        });
    });
}

/// Recopie l'etat dans les listes de l'interface.
fn rafraichir_vue(fenetre: &Coquille, etat: &Arc<Mutex<Etat>>) {
    let Ok(garde) = etat.lock() else { return };
    let Some(amorce) = garde.amorce.as_ref() else { return };

    let espaces: Vec<EspaceVu> = amorce
        .spaces
        .iter()
        .map(|espace| EspaceVu {
            id: espace.id.clone().into(),
            nom: espace.name.clone().into(),
            initiales: initiales(&espace.name).into(),
            actif: garde.espace_actif.as_deref() == Some(espace.id.as_str()),
        })
        .collect();

    let salons: Vec<SalonVu> = amorce
        .channels
        .iter()
        .filter(|salon| salon.space_id.as_deref() == garde.espace_actif.as_deref())
        .map(|salon| SalonVu {
            id: salon.id.clone().into(),
            nom: salon.name.clone().into(),
            vocal: salon.kind == "voice",
            actif: garde.salon_actif.as_deref() == Some(salon.id.as_str()),
        })
        .collect();

    let nom_espace = amorce
        .spaces
        .iter()
        .find(|e| Some(e.id.as_str()) == garde.espace_actif.as_deref())
        .map(|e| e.name.clone())
        .unwrap_or_default();

    let nom_salon = amorce
        .channels
        .iter()
        .find(|c| Some(c.id.as_str()) == garde.salon_actif.as_deref())
        .map(|c| format!("#  {}", c.name))
        .unwrap_or_default();

    fenetre.set_espaces(ModelRc::new(VecModel::from(espaces)));
    fenetre.set_salons(ModelRc::new(VecModel::from(salons)));
    fenetre.set_espace_actif(nom_espace.into());
    fenetre.set_salon_actif(nom_salon.into());
}

/// Charge les derniers messages du salon ouvert.
fn charger_messages(fenetre: &Coquille, etat: &Arc<Mutex<Etat>>) {
    let (Some(session), Some(salon)) = ({
        let garde = etat.lock().ok();
        (
            garde.as_ref().and_then(|g| g.session.clone()),
            garde.as_ref().and_then(|g| g.salon_actif.clone()),
        )
    }) else {
        return;
    };

    // Les noms d'auteurs viennent de l'amorce : les redemander par message
    // multiplierait les requetes pour une information deja en memoire.
    let noms: HashMap<String, String> = etat
        .lock()
        .ok()
        .and_then(|g| g.amorce.as_ref().map(|a| {
            a.profiles
                .iter()
                .map(|p| (p.id.clone(), p.display_name.clone()))
                .collect()
        }))
        .unwrap_or_default();

    let faible = fenetre.as_weak();

    std::thread::spawn(move || {
        let resultat = config::Config::charger()
            .and_then(api::Client::nouveau)
            .and_then(|client| client.messages(&session, &salon, 50));

        let _ = faible.upgrade_in_event_loop(move |f| match resultat {
            Ok(bruts) => {
                let mut vus: Vec<MessageVu> = Vec::with_capacity(bruts.len());
                let mut auteur_precedent: Option<&str> = None;

                for brut in &bruts {
                    let nom = noms
                        .get(&brut.author_id)
                        .cloned()
                        .unwrap_or_else(|| "Inconnu".to_string());

                    // Deux messages de suite du meme auteur sont groupes, comme
                    // sur le web : repeter le nom et l'avatar a chaque ligne
                    // hache la lecture d'une conversation.
                    let groupe = auteur_precedent == Some(brut.author_id.as_str());
                    auteur_precedent = Some(&brut.author_id);

                    vus.push(MessageVu {
                        auteur: if groupe { "".into() } else { nom.into() },
                        heure: heure(&brut.created_at).into(),
                        corps: brut.content.clone().into(),
                        groupe,
                    });
                }

                f.set_messages(ModelRc::new(VecModel::from(vus)));
            }
            Err(message) => f.set_erreur(message.into()),
        });
    });
}

fn brancher_connexion(fenetre: &Coquille, client: Arc<Rc<api::Client>>, etat: Arc<Mutex<Etat>>) {
    // `Rc` ne traverse pas les fils : le client est reconstruit dans chaque fil
    // a partir de la configuration, qui est bon marche a relire.
    let _ = client;

    reprendre_session(fenetre, Arc::clone(&etat));
    brancher_navigation(fenetre, Arc::clone(&etat));

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

/// Choix d'un espace ou d'un salon.
fn brancher_navigation(fenetre: &Coquille, etat: Arc<Mutex<Etat>>) {
    let faible = fenetre.as_weak();
    let etat_espace = Arc::clone(&etat);

    fenetre.on_choisir_espace(move |id| {
        let Some(f) = faible.upgrade() else { return };

        if let Ok(mut garde) = etat_espace.lock() {
            garde.espace_actif = Some(id.to_string());

            // Changer d'espace ouvre son premier salon textuel : garder celui
            // d'avant afficherait une conversation qui n'appartient plus a ce
            // qui est selectionne a gauche.
            garde.salon_actif = garde.amorce.as_ref().and_then(|a| {
                a.channels
                    .iter()
                    .find(|c| c.space_id.as_deref() == Some(id.as_str()) && c.kind == "text")
                    .map(|c| c.id.clone())
            });
        }

        rafraichir_vue(&f, &etat_espace);
        charger_messages(&f, &etat_espace);
    });

    let faible = fenetre.as_weak();
    let etat_salon = Arc::clone(&etat);

    fenetre.on_choisir_salon(move |id| {
        let Some(f) = faible.upgrade() else { return };

        if let Ok(mut garde) = etat_salon.lock() {
            garde.salon_actif = Some(id.to_string());
        }

        rafraichir_vue(&f, &etat_salon);
        charger_messages(&f, &etat_salon);
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
