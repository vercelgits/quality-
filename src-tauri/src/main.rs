// Empeche l'ouverture d'une console noire derriere la fenetre sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    orbit_lib::run()
}
