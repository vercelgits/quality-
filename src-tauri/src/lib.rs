// Orbit — enveloppe de bureau.
//
// L'interface reste celle du web : Tauri se contente de l'afficher dans le
// WebView du systeme. Ce fichier n'ajoute donc que ce qu'un navigateur ne sait
// pas faire — icone de barre des taches, raccourci global, fenetre unique.
//
// Contrairement a Electron, aucun moteur de rendu n'est embarque : le binaire
// pese quelques megaoctets au lieu de cent cinquante, et la memoire consommee
// est celle d'un onglet, pas celle d'un navigateur complet.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Ramene la fenetre au premier plan, en la restaurant si elle etait reduite.
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Une seconde instance ne cree pas de fenetre : elle reveille celle qui
        // existe deja. Sans cela, cliquer deux fois sur l'icone ouvrirait deux
        // applications connectees au meme compte.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Ouvrir Orbit", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("orbit")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Orbit")
                .menu(&menu)
                // Le menu ne doit pas surgir au clic gauche : ce clic sert a
                // afficher la fenetre, geste attendu sur Windows.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => focus_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenetre met en veille dans la barre des taches au lieu
            // de quitter : on continue de recevoir les messages, comme le fait
            // n'importe quelle messagerie de bureau. « Quitter » reste
            // accessible depuis le menu de l'icone.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Orbit n'a pas pu demarrer");
}
