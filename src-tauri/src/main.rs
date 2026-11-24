#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{webview::NewWindowResponse, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::{Update, UpdaterExt};

enum HostCommand {
    ApplyUpdate,
    CheckUpdate { manual: bool },
}

struct UpdateController {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    checking: AtomicBool,
    sender: mpsc::Sender<HostCommand>,
}

struct LocalServer(Mutex<Option<Child>>);

impl LocalServer {
    fn send_line(&self, line: &str) -> bool {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                if let Some(stdin) = child.stdin.as_mut() {
                    return writeln!(stdin, "{line}").is_ok() && stdin.flush().is_ok();
                }
            }
        }
        false
    }
    fn replace(&self, next: LocalServer) {
        self.stop();
        if let (Ok(mut dst), Ok(mut src)) = (self.0.lock(), next.0.lock()) {
            *dst = src.take();
        }
    }
    fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                // Closing stdin requests a clean SQLite shutdown in the Node host.
                drop(child.stdin.take());
                let until = Instant::now() + Duration::from_secs(10);
                while Instant::now() < until {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for LocalServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn ready_url(line: &str) -> Option<Url> {
    let url = Url::parse(line.strip_prefix("FELIX_READY=")?).ok()?;
    (url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some_and(|port| port > 0)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

enum StartupEvent {
    Ready(Url),
    Failed(String),
}

fn sanitize_diagnostic(raw: &str) -> String {
    raw.chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(360)
        .collect()
}

fn error_message(line: &str) -> Option<String> {
    let text = sanitize_diagnostic(line.strip_prefix("FELIX_ERROR=")?);
    (!text.is_empty()).then_some(text)
}

fn default_data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|local| Path::new(&local).join("RepuestosFelix").join("POS"))
}

fn record_native_startup_error(data_dir: Option<&Path>, detail: &str) -> Option<PathBuf> {
    let dir = data_dir?;
    let log_path = dir.join("startup-error.log");
    let _ = fs::create_dir_all(dir);
    let content = format!(
        "Origen: lanzador-windows\nDiagnostico: {}\n",
        sanitize_diagnostic(detail)
    );
    if !log_path.exists() {
        let _ = fs::write(&log_path, content);
    } else if let Ok(existing) = fs::read_to_string(&log_path) {
        if !existing.contains(&sanitize_diagnostic(detail)) {
            let _ = fs::write(&log_path, format!("{existing}\n{content}"));
        }
    }
    Some(log_path)
}

#[cfg(test)]
fn start_server(resources: &Path, data_dir: &Path) -> Result<(LocalServer, Url), String> {
    start_server_with_commands(resources, data_dir, None)
}

fn start_server_with_commands(
    resources: &Path,
    data_dir: &Path,
    command_tx: Option<mpsc::Sender<HostCommand>>,
) -> Result<(LocalServer, Url), String> {
    // Tauri returns canonical Windows paths. Node's CLI rejects the \\?\ prefix.
    let resources = dunce::simplified(resources);
    let app = resources.join("app");
    let node = resources.join("runtime").join("node.exe");
    let mut command = Command::new(&node);
    command
        .arg(app.join("src").join("desktop").join("main.js"))
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--assets")
        .arg(app.join("assets"))
        .current_dir(&app)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|err| {
        format!(
            "No se pudo iniciar el motor local (node.exe): {}.",
            sanitize_diagnostic(&err.to_string())
        )
    })?;
    let output = child.stdout.take().ok_or("No se pudo abrir la salida del servicio local.")?;
    let stderr = child.stderr.take();
    let server = LocalServer(Mutex::new(Some(child)));
    let (send, receive) = mpsc::sync_channel(1);
    let stderr_handle = std::thread::spawn(move || {
        let mut captured = Vec::new();
        if let Some(mut err) = stderr {
            let mut chunk = [0u8; 512];
            while let Ok(read) = err.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                if captured.len() < 2048 {
                    let take = (2048 - captured.len()).min(read);
                    captured.extend_from_slice(&chunk[..take]);
                }
            }
        }
        sanitize_diagnostic(&String::from_utf8_lossy(&captured))
    });
    std::thread::spawn(move || {
        let mut ready_sent = false;
        let mut reported_error: Option<String> = None;
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if !ready_sent {
                if let Some(url) = ready_url(&line) {
                    ready_sent = true;
                    let _ = send.try_send(StartupEvent::Ready(url));
                } else if let Some(message) = error_message(&line) {
                    reported_error = Some(message);
                    break;
                }
            } else if line.trim() == "FELIX_APPLY_UPDATE" {
                if let Some(tx) = command_tx.as_ref() {
                    let _ = tx.send(HostCommand::ApplyUpdate);
                }
            } else if line.trim() == "FELIX_CHECK_UPDATE" {
                if let Some(tx) = command_tx.as_ref() {
                    let _ = tx.send(HostCommand::CheckUpdate { manual: true });
                }
            } else if line.trim() == "FELIX_CHECK_UPDATE_SILENT" {
                if let Some(tx) = command_tx.as_ref() {
                    let _ = tx.send(HostCommand::CheckUpdate { manual: false });
                }
            }
        }
        if !ready_sent {
            let detail = reported_error.unwrap_or_else(|| {
                let err = stderr_handle.join().unwrap_or_default();
                if err.is_empty() {
                    "El servicio local se cerró antes de quedar listo.".into()
                } else {
                    format!("El servicio local falló al iniciar: {err}")
                }
            });
            let _ = send.try_send(StartupEvent::Failed(detail));
        }
    });
    match receive.recv_timeout(Duration::from_secs(90)) {
        Ok(StartupEvent::Ready(url)) => Ok((server, url)),
        Ok(StartupEvent::Failed(detail)) => {
            server.stop();
            Err(detail)
        }
        Err(_) => {
            server.stop();
            Err("Tiempo de espera agotado (90 s) iniciando el servicio local del POS.".into())
        }
    }
}

#[cfg(windows)]
fn notify_shell_icon_change() {
    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(
            event_id: i32,
            flags: u32,
            item1: *const std::ffi::c_void,
            item2: *const std::ffi::c_void,
        );
    }
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0x0000;
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }
}

#[cfg(not(windows))]
fn notify_shell_icon_change() {}

fn record_version_change(data_dir: &Path, version: &str) -> bool {
    let marker = data_dir.join("last-version.txt");
    let previous = fs::read_to_string(&marker).ok();
    if previous.as_deref().map(str::trim) == Some(version) {
        return false;
    }
    let _ = fs::create_dir_all(data_dir);
    let _ = fs::write(&marker, version);
    true
}

fn refresh_shell_icons_if_version_changed(data_dir: &Path, version: &str) {
    if record_version_change(data_dir, version) {
        notify_shell_icon_change();
    }
}

#[cfg(windows)]
fn message_box(title: &str, text: &str, flags: u32) -> i32 {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, caption: *const u16, flags: u32) -> i32;
    }
    let text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let title: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), flags) }
}

fn show_startup_error(detail: &str, log_path: Option<&Path>) {
    #[cfg(windows)]
    {
        let clean = sanitize_diagnostic(detail);
        let mut body = String::from("No se pudo abrir Repuestos Félix.");
        if !clean.is_empty() {
            body.push_str("\n\nDetalle:\n");
            body.push_str(&clean);
        }
        if let Some(path) = log_path {
            body.push_str("\n\nRegistro de diagnóstico:\n");
            body.push_str(&path.display().to_string());
        }
        body.push_str("\n\nComprueba que no esté abierto, que WebView2 esté instalado y que la carpeta de datos permita escribir.");
        message_box("Repuestos Félix", &body, 0x10);
    }
    #[cfg(not(windows))]
    {
        let _ = (detail, log_path);
    }
}

fn show_update_error(detail: &str) {
    #[cfg(windows)]
    {
        message_box("Repuestos Félix", detail, 0x30);
    }
    #[cfg(not(windows))]
    {
        let _ = detail;
    }
}

fn format_update_event(state: &str, version: &str, error: Option<&str>) -> String {
    let payload = serde_json::json!({
        "state": state,
        "version": version,
        "error": error,
    });
    format!("FELIX_UPDATE={payload}")
}

fn emit_update_event(app: &tauri::AppHandle, state: &str, version: &str, error: Option<&str>) {
    if let Some(server) = app.try_state::<LocalServer>() {
        server.send_line(&format_update_event(state, version, error));
    }
}

async fn check_for_update(app: tauri::AppHandle, manual: bool) {
    let Some(controller) = app.try_state::<UpdateController>() else { return; };
    if controller.busy.load(Ordering::SeqCst) {
        return;
    }
    if controller
        .checking
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let current_version = app.package_info().version.to_string();
    let prev_version = controller
        .pending
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|u| u.version.clone()));
    if manual && prev_version.is_none() {
        emit_update_event(&app, "checking", &current_version, None);
    }
    let outcome = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };
    controller.checking.store(false, Ordering::SeqCst);
    match outcome {
        Ok(Some(update)) => {
            let version = update.version.clone();
            if let Ok(mut pending) = controller.pending.lock() {
                *pending = Some(update);
            }
            if manual || prev_version.as_deref() != Some(version.as_str()) {
                emit_update_event(&app, "available", &version, None);
            }
        }
        Ok(None) => {
            if let Ok(mut pending) = controller.pending.lock() {
                *pending = None;
            }
            if manual {
                emit_update_event(&app, "up_to_date", &current_version, None);
            }
        }
        Err(_) => {
            if manual {
                if let Some(ver) = prev_version {
                    emit_update_event(&app, "available", &ver, None);
                } else {
                    emit_update_event(
                        &app,
                        "check_error",
                        &current_version,
                        Some("No se pudo buscar actualizaciones. Revisa tu conexión e inténtalo de nuevo."),
                    );
                }
            }
        }
    }
}

async fn apply_pending_update(app: tauri::AppHandle) {
    let Some(controller) = app.try_state::<UpdateController>() else { return; };
    if controller
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let update = {
        let taken = controller.pending.lock().ok().and_then(|mut guard| guard.take());
        if let Some(found) = taken {
            found
        } else {
            let checked = match app.updater() {
                Ok(updater) => updater.check().await.ok().flatten(),
                Err(_) => None,
            };
            match checked {
                Some(found) => found,
                None => {
                    controller.busy.store(false, Ordering::SeqCst);
                    emit_update_event(
                        &app,
                        "error",
                        "",
                        Some("No se pudo verificar la actualización. Revisa tu conexión e inténtalo de nuevo."),
                    );
                    return;
                }
            }
        }
    };
    let version = update.version.clone();
    emit_update_event(&app, "downloading", &version, None);
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => bytes,
        Err(_) => {
            if let Ok(mut pending) = controller.pending.lock() {
                *pending = Some(update);
            }
            controller.busy.store(false, Ordering::SeqCst);
            emit_update_event(
                &app,
                "error",
                &version,
                Some("No se pudo descargar la actualización automática. Puedes seguir trabajando y reintentar."),
            );
            return;
        }
    };
    emit_update_event(&app, "installing", &version, None);
    std::thread::sleep(Duration::from_millis(150));
    // Cerrar el servidor local Node/SQLite antes de que NSIS reemplace app/ y runtime/node.exe.
    if let Some(server) = app.try_state::<LocalServer>() {
        server.stop();
    }
    if update.install(bytes).is_err() {
        // Intentar recuperar el servidor local en el mismo puerto guardado para no dejar la ventana muerta.
        let sender = controller.sender.clone();
        let restarted = (|| -> Result<(), String> {
            let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
            let data_dir = default_data_dir().ok_or_else(|| "Falta LOCALAPPDATA.".to_string())?;
            let (next_server, _) = start_server_with_commands(&resources, &data_dir, Some(sender))?;
            if let Some(server) = app.try_state::<LocalServer>() {
                server.replace(next_server);
            }
            Ok(())
        })();
        controller.busy.store(false, Ordering::SeqCst);
        if restarted.is_ok() {
            emit_update_event(
                &app,
                "error",
                &version,
                Some("No se pudo completar la instalación. El servicio local se reinició y puedes seguir trabajando."),
            );
        } else {
            show_update_error(
                "No se pudo completar la instalación de la actualización ni reiniciar el servicio local. Cierra y vuelve a abrir Repuestos Félix para continuar.",
            );
            app.exit(1);
        }
        return;
    }
    app.restart();
}

fn main() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = default_data_dir();
            let configured: Result<(), Box<dyn std::error::Error>> = (|| {
                let resources = app.path().resource_dir()?;
                let dir = data_dir.as_deref().ok_or("Falta la carpeta local del usuario (LOCALAPPDATA).")?;
                let (cmd_tx, cmd_rx) = mpsc::channel::<HostCommand>();
                let (server, url) = start_server_with_commands(&resources, dir, Some(cmd_tx.clone()))?;
                app.manage(server);
                app.manage(UpdateController {
                    pending: Mutex::new(None),
                    busy: AtomicBool::new(false),
                    checking: AtomicBool::new(false),
                    sender: cmd_tx,
                });
                let origin = url.origin();
                let current_version = app.package_info().version.to_string();
                refresh_shell_icons_if_version_changed(dir, &current_version);
                let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                    .title("Repuestos Félix")
                    .inner_size(1200.0, 850.0)
                    .min_inner_size(760.0, 600.0)
                    .maximized(true)
                    .prevent_overflow()
                    .resizable(true)
                    .on_navigation(move |next| next.origin() == origin)
                    .on_new_window(|_, _| NewWindowResponse::Deny);
                if let Some(icon) = app.default_window_icon().cloned() {
                    builder = builder.icon(icon)?;
                }
                let window = builder
                    .build()
                    .map_err(|err| format!("No se pudo abrir la ventana del POS (WebView2): {err}"))?;
                let _ = window.maximize();
                let command_handle = app.handle().clone();
                std::thread::spawn(move || {
                    for cmd in cmd_rx {
                        let handle = command_handle.clone();
                        match cmd {
                            HostCommand::ApplyUpdate => {
                                tauri::async_runtime::spawn(apply_pending_update(handle));
                            }
                            HostCommand::CheckUpdate { manual } => {
                                tauri::async_runtime::spawn(check_for_update(handle, manual));
                            }
                        }
                    }
                });
                let update_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    loop {
                        tauri::async_runtime::block_on(check_for_update(update_handle.clone(), false));
                        std::thread::sleep(Duration::from_secs(300));
                    }
                });
                Ok(())
            })();
            if let Err(err) = configured {
                let detail = err.to_string();
                let log_path = record_native_startup_error(data_dir.as_deref(), &detail);
                show_startup_error(&detail, log_path.as_deref());
                app.handle().exit(1);
            }
            Ok(())
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|handle, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(server) = handle.try_state::<LocalServer>() {
                    server.stop();
                }
            }
        }),
        Err(err) => {
            let detail = format!("No se pudo inicializar la aplicación Windows: {err}");
            let data_dir = default_data_dir();
            let log_path = record_native_startup_error(data_dir.as_deref(), &detail);
            show_startup_error(&detail, log_path.as_deref());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{error_message, format_update_event, ready_url, record_version_change, start_server};

    #[test]
    fn records_version_change_only_once_per_version() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("felix-ver-test-{}-{unique}", std::process::id()));
        assert_eq!(record_version_change(&dir, "1.2.15"), true);
        assert_eq!(record_version_change(&dir, "1.2.15"), false);
        assert_eq!(record_version_change(&dir, "1.2.16"), true);
        assert_eq!(record_version_change(&dir, "1.2.16"), false);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(windows)]
    fn bundled_server_starts_from_a_canonical_windows_resource_path() {
        let resources = std::fs::canonicalize(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/windows-payload"),
        ).unwrap();
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let data = std::env::temp_dir().join(format!("felix-native-start-{}-{unique}", std::process::id()));
        let outcome = start_server(&resources, &data);
        if let Ok((server, _)) = &outcome {
            let second_started = std::time::Instant::now();
            let duplicate = start_server(&resources, &data);
            let elapsed = second_started.elapsed();
            assert!(duplicate.is_err(), "a second instance on the same data dir must fail");
            let message = duplicate.err().unwrap();
            assert!(
                message.contains("acceso exclusivo") || message.contains("ya está abierto"),
                "expected clear diagnostic message, got: {message}"
            );
            assert!(elapsed.as_secs() < 20, "duplicate startup must fail fast, took {:?}", elapsed);
            server.stop();
        }
        if data.exists() {
            let actual = std::fs::canonicalize(&data).unwrap();
            let temporary = std::fs::canonicalize(std::env::temp_dir()).unwrap();
            assert_eq!(actual.parent(), Some(temporary.as_path()));
            std::fs::remove_dir_all(actual).unwrap();
        }
        assert!(outcome.is_ok(), "packaged Node failed to start: {:?}", outcome.err());
    }

    #[test]
    fn accepts_only_the_local_hosts_readiness_message() {
        assert!(ready_url("FELIX_READY=http://127.0.0.1:43123").is_some());
        for value in ["http://127.0.0.1:43123", "FELIX_READY=https://example.com", "FELIX_READY=http://127.0.0.1:43123/otra",
            "FELIX_READY=http://user@127.0.0.1:43123", "FELIX_READY=http://127.0.0.1:43123/?token=privado",
            "FELIX_READY=http://localhost:43123", "FELIX_READY=file:///C:/data"] {
            assert!(ready_url(value).is_none(), "{value}");
        }
    }

    #[test]
    fn parses_sanitized_startup_error_lines() {
        assert_eq!(
            error_message("FELIX_ERROR=Error en carga de datos locales: columna faltante"),
            Some("Error en carga de datos locales: columna faltante".into())
        );
        assert_eq!(error_message("FELIX_ERROR=   "), None);
        assert_eq!(error_message("otro mensaje"), None);
    }

    #[test]
    fn formats_single_line_json_update_events() {
        let line = format_update_event("available", "1.2.9", None);
        assert!(line.starts_with("FELIX_UPDATE="));
        assert!(!line.contains('\n'));
        let parsed: serde_json::Value = serde_json::from_str(line.strip_prefix("FELIX_UPDATE=").unwrap()).unwrap();
        assert_eq!(parsed["state"], "available");
        assert_eq!(parsed["version"], "1.2.9");
        assert!(parsed["error"].is_null());

        let err_line = format_update_event("error", "1.2.9", Some("Fallo de red\nreintenta"));
        assert!(!err_line.contains('\n'));
        let err_parsed: serde_json::Value = serde_json::from_str(err_line.strip_prefix("FELIX_UPDATE=").unwrap()).unwrap();
        assert_eq!(err_parsed["state"], "error");
        assert_eq!(err_parsed["error"], "Fallo de red\nreintenta");
    }
}
