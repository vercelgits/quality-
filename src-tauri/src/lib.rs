// Orbit — enveloppe de bureau.
//
// L'interface reste celle du web : Tauri se contente de l'afficher dans le
// WebView du systeme. Ce fichier n'ajoute donc que ce qu'un navigateur ne sait
// pas faire — icone de barre des taches, raccourci global, fenetre unique.
//
// Contrairement a Electron, aucun moteur de rendu n'est embarque : le binaire
// fait 3,4 Mo et l'installateur 1,3 Mo, la ou Electron embarquerait sa propre
// copie de Chromium.
//
// Le gain porte sur la taille livree, pas sur la memoire vive : WebView2 lance
// un Chromium multi-processus comme le ferait Electron, et l'application occupe
// environ 390 Mo au repos. Mieux que Discord, mais pas d'un ordre de grandeur.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Masque la fenetre technique creee par le greffon d'instance unique.
///
/// Sur Windows, ce greffon ouvre une fenetre de seize pixels nommee d'apres
/// l'identifiant de l'application. Elle sert a recevoir le message d'une
/// seconde instance, et devrait rester invisible — mais elle ne l'est pas.
///
/// Les consequences se voient : Windows la designe comme fenetre principale du
/// processus, si bien que la barre des taches affiche « app.orbit.desktop-siw »
/// au lieu d'« Orbit », et elle apparait dans la liste des fenetres a partager.
///
/// La masquer ne l'empeche pas de recevoir des messages : une fenetre cachee
/// garde sa file. Le greffon continue donc de fonctionner.
#[cfg(windows)]
fn hide_single_instance_window(identifier: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, ShowWindow, SW_HIDE};

    let name = HSTRING::from(format!("{identifier}-siw"));

    // Sans classe, la recherche porte sur le seul titre — ce qui suffit, le nom
    // etant derive d'un identifiant unique a l'application.
    if let Ok(handle) = unsafe { FindWindowW(None, &name) } {
        if !handle.is_invalid() {
            let _ = unsafe { ShowWindow(handle, SW_HIDE) };
        }
    }
}

#[cfg(not(windows))]
fn hide_single_instance_window(_identifier: &str) {}

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
            // Le greffon a deja cree sa fenetre a ce stade : la masquer plus
            // tot ne trouverait rien.
            hide_single_instance_window(&app.config().identifier);

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
