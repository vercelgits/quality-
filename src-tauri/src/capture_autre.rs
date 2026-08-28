//! Sources partageables — repli pour les systemes autres que Windows.
//!
//! L'enumeration des fenetres passe par des API propres a chaque systeme :
//! Win32 ici, `CGWindowListCopyWindowInfo` sur macOS, le portail de bureau sur
//! Linux. Seule la premiere est ecrite pour l'instant.
//!
//! Ailleurs, la commande repond une liste vide. L'interface le comprend et
//! retombe sur le selecteur du moteur web, qui lui existe partout : mieux vaut
//! un selecteur qu'on n'a pas dessine que pas de partage du tout.

use serde::Serialize;

#[derive(Serialize)]
pub struct Source {
    pub id: String,
    pub titre: String,
    pub genre: &'static str,
    pub largeur: i32,
    pub hauteur: i32,
    pub vignette: String,
}

#[tauri::command]
pub fn sources_partageables() -> Vec<Source> {
    Vec::new()
}
