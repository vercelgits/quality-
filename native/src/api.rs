//! Acces a Supabase depuis le client natif.
//!
//! Rien ici n'est propre au navigateur : l'authentification et les donnees
//! passent par HTTP, exactement comme le fait le client web. Les regles d'acces
//! restent celles de la base — politiques RLS et fonctions SQL — et sont donc
//! partagees entre les deux clients sans etre reecrites.
//!
//! Les appels sont bloquants et vivent dans un fil separe : la boucle
//! d'evenements de l'interface ne doit jamais attendre le reseau.

use crate::config::Config;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code, reason = "champs de l'API, consommes par les ecrans a venir")]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// Duree de validite en secondes, telle que le serveur l'annonce.
    #[serde(default)]
    pub expires_in: i64,
    pub user: Utilisateur,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code, reason = "champs de l'API, consommes par les ecrans a venir")]
pub struct Utilisateur {
    pub id: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code, reason = "champs de l'API, consommes par les ecrans a venir")]
pub struct Profil {
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

/// Session telle qu'elle est rangee sur disque, sans le profil.
#[derive(Serialize, Deserialize)]
struct SessionEnregistree {
    access_token: String,
    refresh_token: String,
}

pub struct Client {
    http: reqwest::blocking::Client,
    config: Config,
}

/// Detail d'erreur renvoye par Supabase, sous l'un ou l'autre de ses noms.
#[derive(Deserialize)]
struct ErreurSupabase {
    #[serde(default)]
    error_description: Option<String>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

impl Client {
    pub fn nouveau(config: Config) -> Result<Self, String> {
        let http = reqwest::blocking::Client::builder()
            // Sans delai maximal, une machine hors ligne laisserait l'ecran de
            // connexion tourner indefiniment sans rien dire.
            .timeout(std::time::Duration::from_secs(20))
            .user_agent("orbit-natif/0.1")
            .build()
            .map_err(|e| format!("Client HTTP indisponible : {e}"))?;

        Ok(Self { http, config })
    }

    /// Traduit une reponse en echec en une phrase comprehensible.
    ///
    /// Les libelles de Supabase sont en anglais et changent d'une version a
    /// l'autre : on reconnait donc les cas courants par fragment plutot que par
    /// egalite, faute de quoi une reformulation cote serveur ferait ressurgir
    /// de l'anglais technique.
    fn expliquer(corps: &str, statut: u16) -> String {
        let detail = serde_json::from_str::<ErreurSupabase>(corps)
            .ok()
            .and_then(|e| e.error_description.or(e.msg).or(e.message))
            .unwrap_or_default()
            .to_lowercase();

        if detail.contains("invalid login credentials") {
            return "Identifiants incorrects.".into();
        }
        if detail.contains("email not confirmed") {
            return "Adresse non confirmee. Verifiez votre boite de reception.".into();
        }
        if detail.contains("issued at future") || detail.contains("jwt") {
            return "Session refusee. Verifiez la date et l'heure de l'appareil.".into();
        }
        if statut == 429 {
            return "Trop de tentatives. Patientez une minute.".into();
        }
        if detail.is_empty() {
            format!("Le serveur a repondu {statut}.")
        } else {
            detail
        }
    }

    /// Ouvre une session a partir d'une adresse et d'un mot de passe.
    pub fn connexion(&self, email: &str, mot_de_passe: &str) -> Result<Session, String> {
        let reponse = self
            .http
            .post(format!("{}/auth/v1/token?grant_type=password", self.config.url))
            .header("apikey", &self.config.key)
            .json(&serde_json::json!({ "email": email, "password": mot_de_passe }))
            .send()
            .map_err(|_| "Serveur injoignable. Verifiez votre connexion.".to_string())?;

        let statut = reponse.status();
        let corps = reponse.text().unwrap_or_default();

        if !statut.is_success() {
            return Err(Self::expliquer(&corps, statut.as_u16()));
        }

        serde_json::from_str(&corps)
            .map_err(|e| format!("Reponse inattendue du serveur : {e}"))
    }

    /// Renouvelle une session a partir de son jeton de rafraichissement.
    pub fn rafraichir(&self, refresh_token: &str) -> Result<Session, String> {
        let reponse = self
            .http
            .post(format!("{}/auth/v1/token?grant_type=refresh_token", self.config.url))
            .header("apikey", &self.config.key)
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .map_err(|_| "Serveur injoignable.".to_string())?;

        let statut = reponse.status();
        let corps = reponse.text().unwrap_or_default();

        if !statut.is_success() {
            return Err(Self::expliquer(&corps, statut.as_u16()));
        }

        serde_json::from_str(&corps).map_err(|e| format!("Reponse inattendue : {e}"))
    }

    /// Lit le profil de la personne connectee.
    pub fn profil(&self, session: &Session) -> Result<Profil, String> {
        let reponse = self
            .http
            .get(format!("{}/rest/v1/profiles", self.config.url))
            .query(&[("id", format!("eq.{}", session.user.id)), ("select", "*".into())])
            .header("apikey", &self.config.key)
            .header("Authorization", format!("Bearer {}", session.access_token))
            // Sans cet en-tete, PostgREST renvoie un tableau qu'il faudrait
            // deballer a la main pour un resultat unique.
            .header("Accept", "application/vnd.pgrst.object+json")
            .send()
            .map_err(|_| "Serveur injoignable.".to_string())?;

        let statut = reponse.status();
        let corps = reponse.text().unwrap_or_default();

        if !statut.is_success() {
            return Err(Self::expliquer(&corps, statut.as_u16()));
        }

        serde_json::from_str(&corps).map_err(|e| format!("Profil illisible : {e}"))
    }

    /// Ferme la session cote serveur, et efface celle du disque.
    #[allow(dead_code, reason = "branche a la deconnexion quand l'ecran existera")]
    pub fn deconnexion(&self, session: &Session) {
        let _ = self
            .http
            .post(format!("{}/auth/v1/logout", self.config.url))
            .header("apikey", &self.config.key)
            .header("Authorization", format!("Bearer {}", session.access_token))
            .send();

        oublier_session();
    }
}

/* -------------------------------------------------------------------------- */
/* Session conservee entre deux lancements                                     */
/* -------------------------------------------------------------------------- */

fn chemin_session() -> Option<std::path::PathBuf> {
    crate::config::dossier_donnees().map(|d| d.join("session.json"))
}

/// Enregistre la session pour ne pas redemander le mot de passe a chaque
/// lancement.
///
/// Un fichier dans le dossier de l'application, comme le fait le navigateur
/// avec son stockage local. Ce n'est pas un coffre : quiconque a acces au
/// compte Windows peut le lire. Le porter dans le gestionnaire d'identifiants
/// du systeme serait mieux et reste a faire — c'est note dans le README plutot
/// que passe sous silence.
pub fn enregistrer_session(session: &Session) {
    let Some(chemin) = chemin_session() else { return };
    let Some(parent) = chemin.parent() else { return };

    if std::fs::create_dir_all(parent).is_err() {
        return;
    }

    let contenu = SessionEnregistree {
        access_token: session.access_token.clone(),
        refresh_token: session.refresh_token.clone(),
    };

    if let Ok(json) = serde_json::to_string(&contenu) {
        let _ = std::fs::write(chemin, json);
    }
}

/// Relit le jeton de rafraichissement laisse par un lancement precedent.
pub fn session_enregistree() -> Option<String> {
    let contenu = std::fs::read_to_string(chemin_session()?).ok()?;
    let enregistree: SessionEnregistree = serde_json::from_str(&contenu).ok()?;
    Some(enregistree.refresh_token)
}

pub fn oublier_session() {
    if let Some(chemin) = chemin_session() {
        let _ = std::fs::remove_file(chemin);
    }
}
