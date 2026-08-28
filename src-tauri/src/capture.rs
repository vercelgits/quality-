//! Sources partageables : fenetres et ecrans, avec leur vignette.
//!
//! Le moteur web impose sa propre fenetre de selection a chaque appel de
//! `getDisplayMedia`, et aucune page ne peut la remplacer — c'est deliberе,
//! une page ne doit pas pouvoir designer seule ce qu'elle filme. Mais une
//! application de bureau, elle, en a le droit : ce module enumere les sources
//! cote systeme pour que l'interface propose son propre selecteur.
//!
//! Rien n'est envoye nulle part. Les vignettes sont produites a la demande,
//! rendues dans la fenetre de l'application, et jetees ensuite.

use base64::Engine;
use serde::Serialize;

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, EnumDisplayMonitors,
    GetDIBits, GetMonitorInfoW, GetWindowDC, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HDC, HMONITOR, MONITORINFOEXW,
    SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    IsIconic, IsWindow, IsWindowVisible, GA_ROOT, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

/// Une source qu'on peut proposer au partage.
#[derive(Serialize)]
pub struct Source {
    /// Poignee de fenetre, ou index d'ecran prefixe : sert a la capture.
    pub id: String,
    pub titre: String,
    /// `fenetre` ou `ecran`.
    pub genre: &'static str,
    pub largeur: i32,
    pub hauteur: i32,
    /// Vignette PNG en `data:` — vide si la capture a echoue.
    pub vignette: String,
}

/// Largeur des vignettes. Assez pour reconnaitre une fenetre, assez peu pour
/// que dresser la liste entiere reste instantane.
const VIGNETTE_LARGEUR: i32 = 320;

/// Vrai si Windows considere la fenetre comme masquee.
///
/// Une fenetre peut etre « visible » au sens de `IsWindowVisible` tout en etant
/// escamotee par le gestionnaire de bureau : applications du Store suspendues,
/// fenetres d'un autre bureau virtuel. Elles n'ont rien a faire dans la liste,
/// et leur capture ne rendrait qu'un rectangle noir.
fn escamotee(fenetre: HWND) -> bool {
    let mut masquee: u32 = 0;
    let taille = std::mem::size_of::<u32>() as u32;

    let ok = unsafe {
        DwmGetWindowAttribute(
            fenetre,
            DWMWA_CLOAKED,
            &mut masquee as *mut u32 as *mut _,
            taille,
        )
    };

    ok.is_ok() && masquee != 0
}

/// Titre de la fenetre, ou une chaine vide.
fn titre(fenetre: HWND) -> String {
    let longueur = unsafe { GetWindowTextLengthW(fenetre) };
    if longueur <= 0 {
        return String::new();
    }

    let mut tampon = vec![0u16; longueur as usize + 1];
    let ecrits = unsafe { GetWindowTextW(fenetre, &mut tampon) };
    String::from_utf16_lossy(&tampon[..ecrits as usize])
}

/// Retient les fenetres qu'un humain reconnaitrait comme une application.
fn partageable(fenetre: HWND) -> bool {
    if !unsafe { IsWindowVisible(fenetre) }.as_bool() {
        return false;
    }

    // Une fenetre reduite n'a plus de contenu a capturer.
    if unsafe { IsIconic(fenetre) }.as_bool() {
        return false;
    }

    // Seules les fenetres racines : les boites de dialogue appartenant a une
    // application apparaitraient sinon a cote d'elle, sans qu'on sache
    // laquelle choisir.
    if unsafe { GetAncestor(fenetre, GA_ROOT) } != fenetre {
        return false;
    }

    // Les palettes d'outils ne sont pas des fenetres qu'on partage.
    let styles = unsafe { GetWindowLongW(fenetre, GWL_EXSTYLE) } as u32;
    if styles & WS_EX_TOOLWINDOW.0 != 0 {
        return false;
    }

    if escamotee(fenetre) {
        return false;
    }

    let mut cadre = RECT::default();
    if unsafe { GetWindowRect(fenetre, &mut cadre) }.is_err() {
        return false;
    }

    // Sous cette taille, c'est une fenetre technique, pas une application.
    (cadre.right - cadre.left) >= 160 && (cadre.bottom - cadre.top) >= 120
}

/// Encode des pixels BGRA en PNG, puis en `data:`.
fn en_png(pixels: &[u8], largeur: u32, hauteur: u32) -> Option<String> {
    let mut rgba = Vec::with_capacity(pixels.len());
    for bloc in pixels.chunks_exact(4) {
        // GDI rend du BGRA ; PNG attend du RGBA. Le canal alpha renvoye par
        // `GetDIBits` n'est pas fiable, on le force a l'opacite.
        rgba.extend_from_slice(&[bloc[2], bloc[1], bloc[0], 255]);
    }

    let mut brut = Vec::new();
    {
        let mut encodeur = png::Encoder::new(&mut brut, largeur, hauteur);
        encodeur.set_color(png::ColorType::Rgba);
        encodeur.set_depth(png::BitDepth::Eight);
        let mut ecrivain = encodeur.write_header().ok()?;
        ecrivain.write_image_data(&rgba).ok()?;
    }

    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&brut)
    ))
}

/// Capture une zone de l'ecran, reduite a la taille d'une vignette.
///
/// La lecture passe par l'ecran plutot que par `PrintWindow` : ce dernier
/// echoue sur tout ce qui dessine en accelere — un jeu, un lecteur video —
/// c'est-a-dire precisement ce qu'on partage le plus souvent.
fn vignette_de(zone: RECT) -> Option<String> {
    let largeur = zone.right - zone.left;
    let hauteur = zone.bottom - zone.top;
    if largeur <= 0 || hauteur <= 0 {
        return None;
    }

    let cible_l = VIGNETTE_LARGEUR.min(largeur);
    let cible_h = ((cible_l as f32) * (hauteur as f32) / (largeur as f32)).round() as i32;
    if cible_h <= 0 {
        return None;
    }

    unsafe {
        let ecran = GetWindowDC(HWND(std::ptr::null_mut()));
        if ecran.is_invalid() {
            return None;
        }

        let memoire = CreateCompatibleDC(ecran);
        let bitmap = CreateCompatibleBitmap(ecran, cible_l, cible_h);
        let ancien = SelectObject(memoire, bitmap);

        // Sans ce mode, la reduction procede par abandon de lignes et le
        // resultat est illisible : on ne reconnait plus la fenetre.
        SetStretchBltMode(memoire, HALFTONE);

        let copie = StretchBlt(
            memoire, 0, 0, cible_l, cible_h, ecran, zone.left, zone.top, largeur, hauteur, SRCCOPY,
        );

        let mut resultat = None;

        if copie.as_bool() {
            let mut entete = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: cible_l,
                    // Negatif : sans cela GDI rend l'image a l'envers.
                    biHeight: -cible_h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut pixels = vec![0u8; (cible_l * cible_h * 4) as usize];
            let lues = GetDIBits(
                memoire,
                bitmap,
                0,
                cible_h as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut entete,
                DIB_RGB_COLORS,
            );

            if lues != 0 {
                resultat = en_png(&pixels, cible_l as u32, cible_h as u32);
            }
        }

        SelectObject(memoire, ancien);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memoire);
        ReleaseDC(HWND(std::ptr::null_mut()), ecran);

        resultat
    }
}

/// Rappel d'`EnumWindows`, qui empile les fenetres retenues.
unsafe extern "system" fn collecter(fenetre: HWND, contexte: LPARAM) -> BOOL {
    let liste = &mut *(contexte.0 as *mut Vec<Source>);

    if !partageable(fenetre) {
        return TRUE;
    }

    let nom = titre(fenetre);
    if nom.trim().is_empty() {
        return TRUE;
    }

    // Notre propre fenetre : la partager reviendrait a filmer le selecteur.
    if nom == "Orbit" {
        return TRUE;
    }

    let mut cadre = RECT::default();
    if GetWindowRect(fenetre, &mut cadre).is_err() {
        return TRUE;
    }

    liste.push(Source {
        id: format!("fenetre:{}", fenetre.0 as isize),
        titre: nom,
        genre: "fenetre",
        largeur: cadre.right - cadre.left,
        hauteur: cadre.bottom - cadre.top,
        vignette: vignette_de(cadre).unwrap_or_default(),
    });

    TRUE
}

/// Rappel d'`EnumDisplayMonitors`.
unsafe extern "system" fn collecter_ecran(
    moniteur: HMONITOR,
    _dc: HDC,
    _zone: *mut RECT,
    contexte: LPARAM,
) -> BOOL {
    let liste = &mut *(contexte.0 as *mut Vec<Source>);

    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

    if !GetMonitorInfoW(moniteur, &mut info.monitorInfo as *mut _).as_bool() {
        return TRUE;
    }

    let cadre = info.monitorInfo.rcMonitor;
    let index = liste.iter().filter(|s| s.genre == "ecran").count() + 1;

    liste.push(Source {
        id: format!("ecran:{}", moniteur.0 as isize),
        titre: if info.monitorInfo.dwFlags & 1 != 0 {
            "Ecran principal".to_string()
        } else {
            format!("Ecran {index}")
        },
        genre: "ecran",
        largeur: cadre.right - cadre.left,
        hauteur: cadre.bottom - cadre.top,
        vignette: vignette_de(cadre).unwrap_or_default(),
    });

    TRUE
}

/// Liste les ecrans puis les fenetres, vignettes comprises.
#[tauri::command]
pub fn sources_partageables() -> Vec<Source> {
    let mut liste: Vec<Source> = Vec::new();
    let contexte = LPARAM(&mut liste as *mut Vec<Source> as isize);

    unsafe {
        // Les ecrans d'abord : c'est le choix le plus courant, il doit arriver
        // en tete sans que l'interface ait a retrier.
        let _ = EnumDisplayMonitors(
            HDC(std::ptr::null_mut()),
            None,
            Some(collecter_ecran),
            contexte,
        );
        let _ = EnumWindows(Some(collecter), contexte);
    }

    liste
}

/// Position d'une source a l'ecran, en pixels physiques.
#[derive(Serialize)]
pub struct Zone {
    pub x: i32,
    pub y: i32,
    pub largeur: i32,
    pub hauteur: i32,
    /// Faux quand la fenetre a disparu ou a ete reduite depuis le choix.
    pub visible: bool,
}

/// Ou se trouve la source choisie, maintenant.
///
/// La capture porte toujours sur l'ecran entier — c'est la seule facon d'eviter
/// la fenetre de selection du moteur web. Partager une fenetre seule consiste
/// donc a decouper cette image, et le decoupage doit suivre la fenetre quand on
/// la deplace ou la redimensionne. D'ou cette interrogation repetee plutot
/// qu'une position figee au depart.
#[tauri::command]
pub fn zone_source(id: String) -> Zone {
    let absente = Zone {
        x: 0,
        y: 0,
        largeur: 0,
        hauteur: 0,
        visible: false,
    };

    let Some((genre, valeur)) = id.split_once(':') else {
        return absente;
    };

    let Ok(poignee) = valeur.parse::<isize>() else {
        return absente;
    };

    if genre == "ecran" {
        let moniteur = HMONITOR(poignee as *mut _);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        let ok = unsafe { GetMonitorInfoW(moniteur, &mut info.monitorInfo as *mut _) };
        if !ok.as_bool() {
            return absente;
        }

        let cadre = info.monitorInfo.rcMonitor;
        return Zone {
            x: cadre.left,
            y: cadre.top,
            largeur: cadre.right - cadre.left,
            hauteur: cadre.bottom - cadre.top,
            visible: true,
        };
    }

    let fenetre = HWND(poignee as *mut _);

    if !unsafe { IsWindow(fenetre) }.as_bool() || !partageable(fenetre) {
        return absente;
    }

    let mut cadre = RECT::default();
    if unsafe { GetWindowRect(fenetre, &mut cadre) }.is_err() {
        return absente;
    }

    Zone {
        x: cadre.left,
        y: cadre.top,
        largeur: cadre.right - cadre.left,
        hauteur: cadre.bottom - cadre.top,
        visible: true,
    }
}
