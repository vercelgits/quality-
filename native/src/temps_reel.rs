//! Flux temps reel de Supabase.
//!
//! Supabase Realtime parle le protocole de Phoenix : on ouvre un WebSocket, on
//! rejoint un sujet, puis on recoit des evenements. Il faut aussi envoyer un
//! battement regulier, sans quoi le serveur ferme la connexion au bout d'une
//! minute.
//!
//! Le fil ne fait qu'attendre : une variante asynchrone demanderait tout un
//! ordonnanceur pour une seule connexion.

use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};
use tungstenite::Message;

/// Ce que le flux fait remonter a l'interface.
pub enum Evenement {
    /// Un message est arrive dans le salon suivi.
    NouveauMessage { salon: String },
    /// La connexion est etablie ou perdue, pour l'indiquer a l'ecran.
    Etat { connecte: bool },
}

/// Suit les messages d'un projet, et signale ceux qui arrivent.
///
/// Tourne jusqu'a ce que le canal de sortie soit ferme — c'est-a-dire jusqu'a
/// la fermeture de l'application.
pub fn suivre(url_projet: String, cle: String, jeton: String, sortie: Sender<Evenement>) {
    // Une coupure reseau ne doit pas arreter le suivi definitivement : on
    // repart, en espacant les tentatives pour ne pas marteler un serveur qui
    // est peut-etre en train de redemarrer.
    let mut attente = Duration::from_secs(1);

    loop {
        match boucle(&url_projet, &cle, &jeton, &sortie) {
            Ok(()) => return, // Canal ferme : l'application se termine.
            Err(_) => {
                let _ = sortie.send(Evenement::Etat { connecte: false });
                std::thread::sleep(attente);
                attente = (attente * 2).min(Duration::from_secs(30));
            }
        }
    }
}

fn boucle(
    url_projet: &str,
    cle: &str,
    jeton: &str,
    sortie: &Sender<Evenement>,
) -> Result<(), String> {
    let adresse = format!(
        "{}/realtime/v1/websocket?apikey={}&vsn=1.0.0",
        url_projet.replace("https://", "wss://"),
        cle
    );

    let (mut socket, _) =
        tungstenite::connect(&adresse).map_err(|e| format!("connexion refusee : {e}"))?;

    // Le sujet couvre toute la table : le filtrage par salon se fait a
    // l'arrivee. Un sujet par salon obligerait a rejoindre et quitter a chaque
    // navigation, pour une economie sans objet a cette echelle.
    let rejoindre = serde_json::json!({
        "topic": "realtime:public:messages",
        "event": "phx_join",
        "ref": "1",
        "payload": {
            "config": {
                "postgres_changes": [
                    { "event": "INSERT", "schema": "public", "table": "messages" }
                ]
            },
            "access_token": jeton
        }
    });

    socket
        .send(Message::Text(rejoindre.to_string()))
        .map_err(|e| format!("adhesion impossible : {e}"))?;

    let _ = sortie.send(Evenement::Etat { connecte: true });

    let mut dernier_battement = Instant::now();
    let mut compteur = 2u64;

    loop {
        // Sans battement, le serveur coupe au bout d'une minute d'inactivite —
        // et un salon calme est precisement inactif.
        if dernier_battement.elapsed() > Duration::from_secs(25) {
            let battement = serde_json::json!({
                "topic": "phoenix",
                "event": "heartbeat",
                "ref": compteur.to_string(),
                "payload": {}
            });
            socket
                .send(Message::Text(battement.to_string()))
                .map_err(|e| format!("battement perdu : {e}"))?;

            compteur += 1;
            dernier_battement = Instant::now();
        }

        match socket.read() {
            Ok(Message::Text(texte)) => {
                if let Some(salon) = salon_du_message(&texte) {
                    // Le canal ferme signifie que l'application se termine.
                    if sortie.send(Evenement::NouveauMessage { salon }).is_err() {
                        return Ok(());
                    }
                }
            }
            Ok(Message::Close(_)) => return Err("connexion fermee".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(format!("lecture interrompue : {e}")),
        }
    }
}

/// Extrait le salon d'un evenement d'insertion, s'il s'agit bien d'un message.
fn salon_du_message(texte: &str) -> Option<String> {
    let valeur: serde_json::Value = serde_json::from_str(texte).ok()?;

    if valeur.get("event")?.as_str()? != "postgres_changes" {
        return None;
    }

    let donnees = valeur.get("payload")?.get("data")?;
    if donnees.get("type")?.as_str()? != "INSERT" {
        return None;
    }

    donnees
        .get("record")?
        .get("channel_id")?
        .as_str()
        .map(str::to_string)
}
