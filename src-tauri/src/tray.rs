//! Menu bar icon. Shows what's playing next to the icon; click toggles the
//! window, the menu has transport controls. Transport actions are emitted to
//! the frontend as `tray` events because it knows which room is selected.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

const ID: &str = "main";

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app, None, false)?;
    TrayIconBuilder::with_id(ID)
        .icon(icon())
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "show" => show(app),
            "quit" => app.exit(0),
            action => {
                if action == "mini" || action == "full" {
                    show(app);
                }
                let _ = app.emit("tray", action.to_string());
            }
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, now: Option<&str>, playing: bool) -> tauri::Result<Menu<R>> {
    let np = MenuItem::with_id(app, "np", now.unwrap_or("Nothing playing"), false, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &np,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "toggle", if playing { "Pause" } else { "Play" }, true, None::<&str>)?,
            &MenuItem::with_id(app, "next", "Next", true, None::<&str>)?,
            &MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "show", "Show Sonos UI", true, None::<&str>)?,
            &MenuItem::with_id(app, "mini", "Mini player", true, None::<&str>)?,
            &MenuItem::with_id(app, "full", "Full player", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?,
        ],
    )
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show(app);
        }
    }
}

fn tray<R: Runtime>(app: &AppHandle<R>) -> Option<TrayIcon<R>> {
    app.tray_by_id(ID)
}

/// Called from the frontend whenever the playing track changes.
#[tauri::command]
pub fn tray_update(app: AppHandle, title: Option<String>, artist: Option<String>, playing: bool) -> Result<(), String> {
    let Some(t) = tray(&app) else { return Ok(()) };
    let full = match (&title, &artist) {
        (Some(t), Some(a)) if !a.is_empty() => Some(format!("{t} — {a}")),
        (Some(t), _) => Some(t.clone()),
        _ => None,
    };
    // keep the menu bar text short; the menu has the full line
    let short = title.as_ref().filter(|_| playing).map(|t| {
        let t: String = t.chars().take(28).collect();
        if t.chars().count() < title.as_ref().unwrap().chars().count() { format!("{}…", t.trim_end()) } else { t }
    });
    t.set_title(short.as_deref()).map_err(|e| e.to_string())?;
    t.set_tooltip(full.as_deref()).map_err(|e| e.to_string())?;
    let menu = build_menu(&app, full.as_deref(), playing).map_err(|e| e.to_string())?;
    t.set_menu(Some(menu)).map_err(|e| e.to_string())
}

/// 22pt template icon drawn in code (a little speaker: rounded box + cone),
/// so there's no extra asset to ship. Black + alpha; macOS tints it.
fn icon() -> Image<'static> {
    const S: usize = 44; // @2x of 22pt
    let mut px = vec![0u8; S * S * 4];
    let mut set = |x: usize, y: usize, a: u8| {
        let i = (y * S + x) * 4;
        px[i + 3] = px[i + 3].max(a);
    };
    let (cx, cy) = (22.0f32, 22.0f32);
    for y in 0..S {
        for x in 0..S {
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            // rounded rectangle outline 26x36, radius 6, stroke 3
            let (hw, hh, r) = (13.0f32, 18.0f32, 6.0f32);
            let dx = ((fx - cx).abs() - (hw - r)).max(0.0);
            let dy = ((fy - cy).abs() - (hh - r)).max(0.0);
            let d = (dx * dx + dy * dy).sqrt() - r; // signed distance to rounded rect
            // 3px stroke just inside the edge, 1px anti-aliased falloff
            let stroke = (2.0 - (d + 1.5).abs()).clamp(0.0, 1.0);
            // woofer: ring around (22, 26) r=7, stroke 3
            let wd = ((fx - cx).powi(2) + (fy - 26.0).powi(2)).sqrt();
            let woofer = (1.0 - ((wd - 6.5).abs() - 1.5).max(0.0)).clamp(0.0, 1.0);
            // tweeter dot at (22, 12) r=2.5
            let td = ((fx - cx).powi(2) + (fy - 12.0).powi(2)).sqrt();
            let tweeter = (3.0 - td).clamp(0.0, 1.0);
            let a = stroke.max(woofer).max(tweeter);
            if a > 0.0 {
                set(x, y, (a * 255.0) as u8);
            }
        }
    }
    Image::new_owned(px, S as u32, S as u32)
}
