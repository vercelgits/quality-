// Orbit — client natif.
//
// Aucun moteur web : l'interface est decrite en Slint et rendue directement par
// le systeme. C'est la premiere etape d'une reecriture, pas encore une
// application utilisable — voir native/README.md pour ce qui reste a faire.
//
// La fenetre sans decoration est volontaire : la barre de titre est dessinee
// par l'application, comme dans les clients de messagerie modernes, ce qui
// evite le bandeau gris du systeme au-dessus d'une interface sombre.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

slint::include_modules!();

fn main() -> Result<(), slint::PlatformError> {
    let fenetre = Coquille::new()?;

    // Fermeture depuis la barre de titre dessinee par l'application.
    {
        let faible = fenetre.as_weak();
        fenetre.on_fermer(move || {
            if let Some(f) = faible.upgrade() {
                let _ = f.window().hide();
            }
        });
    }

    {
        let faible = fenetre.as_weak();
        fenetre.on_reduire(move || {
            if let Some(f) = faible.upgrade() {
                f.window().set_minimized(true);
            }
        });
    }

    {
        let faible = fenetre.as_weak();
        fenetre.on_agrandir(move || {
            if let Some(f) = faible.upgrade() {
                let etat = f.window().is_maximized();
                f.window().set_maximized(!etat);
            }
        });
    }

    fenetre.run()
}
