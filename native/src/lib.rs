//! Modules partages entre le binaire et les tests d'integration.
//!
//! Un binaire seul n'est pas importable : sans cette bibliotheque, les tests
//! devraient recopier le client HTTP, et verifieraient alors une copie plutot
//! que le code reellement livre.

pub mod api;
pub mod config;
pub mod temps_reel;
