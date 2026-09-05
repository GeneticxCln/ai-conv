// AI Conv — Tauri 2 desktop shell.
//
// Architecture (mirrors the Electron shell's responsibilities, minus Chromium):
//  - Backend supervision: spawn the backend as a SIDECAR BINARY
//    (binaries/ai-conv-backend-<triple>, built by sidecar/build.sh with @yao-pkg/pkg)
//    when present; otherwise fall back to a bundled Node runtime + backend dist
//    resource (the same mechanism Electron used). DEV mode: if something already
//    listens on the backend port, attach to it instead of spawning.
//  - Health gating: the main window stays hidden until GET /health answers —
//    same anti-white-screen behavior as Electron.
//  - Tray: Show / Quit. Close-to-tray keeps the backend warm, like Electron.
//  - gpu_info command: returns { available, name, totalMiB, usedMiB } for the
//    VRAM warnings in the persona modal and Settings model list.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const BACKEND_PORT: u16 = 3001;
// pkg binaries self-extract + migrations can take a while on first boot.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct BackendHandle(Mutex<Option<std::process::Child>>);

#[derive(Serialize)]
struct GpuInfo {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_mib: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    used_mib: Option<u64>,
}

fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(150),
    )
    .is_ok()
}

/// Poll GET /health until the backend answers (or timeout).
fn wait_for_health(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if ureq_none().success {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// Minimal HTTP GET without adding a blocking HTTP crate dependency: use
/// std TcpStream + a hand-rolled request. /health is a tiny JSON response, so
/// a 4 KB read is plenty.
struct TinyResp {
    success: bool,
}

fn ureq_none() -> TinyResp {
    use std::io::{Read, Write};
    // url is always our own loopback /health string — safe to parse simply.
    let host = format!("127.0.0.1:{BACKEND_PORT}");
    let inner = || -> Result<TinyResp, std::io::Error> {
        let mut stream = TcpStream::connect(&host)?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        write!(
            stream,
            "GET /health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
        )?;
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]);
        Ok(TinyResp {
            success: head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200"),
        })
    };
    inner().unwrap_or(TinyResp { success: false })
}

fn sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Exact Tauri CLI naming: binaries/ai-conv-backend-<target-triple>. The
    // triple is baked in by build.rs from cargo's TARGET.
    let triple = env!("AI_CONV_TARGET_TRIPLE");
    let exact = format!("ai-conv-backend-{triple}");
    for base in resource_base_dirs(app) {
        for c in [exact.as_str(), "ai-conv-backend"] {
            let p = base.join(&c);
            if p.exists() {
                return Some(p);
            }
            let p = base.join("binaries").join(&c);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// Directories to search for sidecar binaries and resources, covering both
/// `tauri build` bundles (resource_dir) and plain `cargo build` dev runs
/// (exe dir + the src-tauri tree above it).
fn resource_base_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        dirs.push(rd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            // target/release → ../.. → src-tauri/{binaries,resources}
            dirs.push(dir.join("../.."));
        }
    }
    dirs
}

fn find_bundled_node(app: &tauri::AppHandle) -> Option<PathBuf> {
    for base in resource_base_dirs(app) {
        let node = base.join("runtime").join("node");
        if node.exists() {
            return Some(node);
        }
    }
    // Fallback: system node (dev machines)
    which_node()
}

fn which_node() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join("node");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn start_backend(app: &tauri::AppHandle) -> Result<(), String> {
    // Dev convenience: attach to an already-running backend instead of
    // spawning a second one (mirrors Electron's isPortInUse bail-out).
    if port_in_use(BACKEND_PORT) {
        println!("[tauri] backend already listening on {BACKEND_PORT} — attaching");
        return Ok(());
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let data_dir = app_data.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("mkdir data: {e}"))?;

    let (mut cmd, kind): (std::process::Command, &str) = if let Some(sidecar) = sidecar_path(app) {
        let mut c = std::process::Command::new(&sidecar);
        c.arg("--port").arg(BACKEND_PORT.to_string());
        (c, "sidecar binary")
    } else if let Some(node) = find_bundled_node(app) {
        // Fallback: bundled node runtime + backend dist resource. This is the
        // Electron mechanism, kept so the shell can ship before the sidecar
        // build is wired into CI.
        let mut index_js = None;
        for base in resource_base_dirs(app) {
            // resources/backend/dist/index.js (sidecar layout) and the direct
            // dist layout both checked.
            for candidate in [
                base.join("backend").join("dist").join("index.js"),
                base.join("resources").join("backend").join("dist").join("index.js"),
            ] {
                if candidate.exists() {
                    index_js = Some(candidate);
                    break;
                }
            }
            if index_js.is_some() {
                break;
            }
        }
        let index_js = match index_js {
            Some(p) => p,
            None => return Err("backend dist not found in any resource dir".into()),
        };
        let backend_nm = index_js.parent().and_then(|d| d.parent()).map(|d| d.join("node_modules")).unwrap_or_default();
        let mut c = std::process::Command::new(&node);
        c.arg(&index_js);
        c.env("NODE_PATH", &backend_nm);
        (c, "node runtime")
    } else {
        return Err("No sidecar binary and no node runtime found".into());
    };

    let jwt = std::env::var("JWT_SECRET")
        .ok()
        .or_else(|| read_jwt_secret(&app_data))
        .unwrap_or_else(|| {
            // First launch with no secret: generate one and persist it so
            // restarts keep the same sessions (same contract as Electron).
            let secret = generate_secret();
            let _ = std::fs::write(app_data.join(".jwt-secret"), &secret);
            secret
        });

    cmd.env("PORT", BACKEND_PORT.to_string())
        .env("DATABASE_PATH", data_dir.join("ai-conv.db"))
        .env("JWT_SECRET", jwt)
        .env("OLLAMA_HOST", std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".into()))
        // The Tauri webview loads the app from embedded assets; the backend
        // still serves frontend-dist for single-port browser access. Resolve
        // the bundled frontend copy from the same base dirs as the sidecar.
        .env(
            "FRONTEND_DIST",
            resource_base_dirs(app)
                .iter()
                .map(|base| base.join("resources").join("frontend-dist"))
                .chain(
                    resource_base_dirs(app)
                        .iter()
                        .map(|base| base.join("frontend-dist")),
                )
                .find(|p| p.exists())
                .unwrap_or_else(|| PathBuf::from("/nonexistent")),
        )
        // The backend serves the frontend on the same port; the Tauri webview
        // in dev loads Vite (5173) — allow both origins.
        .env(
            "CORS_ORIGIN",
            "http://localhost:5173,http://127.0.0.1:3001,http://localhost:3001,tauri://localhost,http://tauri.localhost",
        )
        .env("NODE_ENV", "production")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    println!("[tauri] starting backend ({kind})...");
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn backend: {e}"))?;

    // Pipe backend logs to our stdout with a [backend] prefix.
    if let Some(out) = child.stdout.take() {
        spawn_log_thread(out);
    }
    if let Some(err) = child.stderr.take() {
        spawn_log_thread(err);
    }

    *app.state::<BackendHandle>().0.lock().unwrap() = Some(child);
    Ok(())
}

fn spawn_log_thread<R: std::io::Read + Send + 'static>(mut stream: R) {
    std::thread::spawn(move || {
        use std::io::BufRead;
        let mut reader = std::io::BufReader::new(&mut stream);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => println!("[backend] {}", line.trim_end()),
            }
        }
    });
}

fn read_jwt_secret(app_data: &PathBuf) -> Option<String> {
    std::fs::read_to_string(app_data.join(".jwt-secret"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn generate_secret() -> String {
    // 32 bytes of entropy hex-encoded, read from the OS CSPRNG.
    use std::io::Read;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .expect("read /dev/urandom");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
fn gpu_info() -> GpuInfo {
    // Same CSV contract the backend gpuInfo module uses.
    let output = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total,memory.used",
            "--format=csv,noheader,nounits",
        ])
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let line = text.lines().next().unwrap_or("").trim();
            let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
            if parts.len() >= 3 {
                return GpuInfo {
                    available: true,
                    name: Some(parts[0].to_string()),
                    total_mib: parts[1].parse().ok(),
                    used_mib: parts[2].parse().ok(),
                };
            }
            GpuInfo { available: false, name: None, total_mib: None, used_mib: None }
        }
        _ => GpuInfo { available: false, name: None, total_mib: None, used_mib: None },
    }
}

fn kill_backend(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<BackendHandle>().0.lock().unwrap().take() {
        let _ = child.kill();
        println!("[tauri] backend stopped");
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // Auto-update: signed update bundles via tauri-plugin-updater. The
        // JS side (frontend/src/lib/updater.ts) drives check/download/install;
        // without a configured endpoint every call fails gracefully to no-op.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Relaunch-after-update (frontend/src/lib/updater.ts).
        .plugin(tauri_plugin_process::init())
        .manage(BackendHandle::default())
        .invoke_handler(tauri::generate_handler![gpu_info])
        .setup(|app| {
            let handle = app.handle().clone();

            // Single instance: focus the existing window instead.
            #[cfg(desktop)]
            {
                use tauri_plugin_single_instance as single;
                app.handle().plugin(single::init(|app, _args, _cwd| {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }))
                .map_err(|e| format!("single-instance: {e}"))?;
            }

            start_backend(&handle)?;

            // The window loads the BACKEND's own URL (same as Electron), where
            // the frontend is served same-origin — socket.io needs no CORS and
            // no tauri://localhost cross-origin workarounds.
            let _win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(
                    format!("http://127.0.0.1:{BACKEND_PORT}")
                        .parse()
                        .map_err(|e| format!("bad backend url: {e}"))?,
                ),
            )
            .title("AI Conv")
            .inner_size(1200.0, 820.0)
            .min_inner_size(900.0, 600.0)
            .visible(false)
            .center()
            .on_navigation(|url| {
                // Only our backend URL may render inside the window; anything
                // else (external links, popups) opens in the system browser —
                // parity with Electron's setWindowOpenHandler.
                let s = url.to_string();
                let is_backend = s.starts_with(&format!("http://127.0.0.1:{BACKEND_PORT}"))
                    || s.starts_with("http://localhost:3001");
                if !is_backend && (s.starts_with("http://") || s.starts_with("https://")) {
                    let _ = open::that(&s);
                    return false;
                }
                true
            })
            .build()
            .map_err(|e| format!("create window: {e}"))?;

            // Tray: Show / Quit (parity with Electron).
            if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!(
                "../icons/tray-icon.png"
            )) {
                let show = tauri::menu::MenuItem::with_id(app, "show", "Show AI Conv", true, None::<&str>)?;
                let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
                let tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .menu(&menu)
                    .tooltip("AI Conv")
                    .show_menu_on_left_click(false)
                    .build(app)?;
                tray.on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        kill_backend(app);
                        app.exit(0);
                    }
                    _ => {}
                });
            }

            // Health gate: only navigate + show the window once the backend
            // answers. Navigate AFTER health so the first paint is the real
            // app, never an error page.
            std::thread::spawn(move || {
                let healthy = wait_for_health(HEALTH_TIMEOUT);
                if !healthy {
                    // Even on health-check failure, navigate + show — better
                    // a visible error page than an app the user thinks is
                    // dead (same policy as Electron).
                    println!("[tauri] backend health check timed out — showing window anyway");
                }
                let url = format!("http://127.0.0.1:{BACKEND_PORT}");
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.navigate(url.parse().expect("valid url"));
                    if healthy {
                        println!("[tauri] backend healthy — showing window");
                    }
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: keep the backend warm, like Electron.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                kill_backend(app_handle);
            }
        });
}
