#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{webview::NewWindowResponse, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

struct LocalServer(Mutex<Option<Child>>);

impl LocalServer {
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

fn start_server(resources: &Path, data_dir: &Path) -> Result<(LocalServer, Url), String> {
    // Tauri returns canonical Windows paths. Node's CLI rejects the \\?\ prefix.
    let resources = dunce::simplified(resources);
    let app = resources.join("app");
    let mut command = Command::new(resources.join("runtime").join("node.exe"));
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
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|_| "No se pudo iniciar el servicio local.")?;
    let output = child.stdout.take().ok_or("No se pudo abrir el servicio local.")?;
    let server = LocalServer(Mutex::new(Some(child)));
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Some(url) = ready_url(&line) {
                let _ = send.try_send(url);
            }
        }
    });
    match receive.recv_timeout(Duration::from_secs(90)) {
        Ok(url) => Ok((server, url)),
        Err(_) => {
            server.stop();
            Err("No se pudo abrir el POS. Comprueba que no esté abierto y que la carpeta de datos permita escribir.".into())
        }
    }
}

fn show_startup_error() {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, caption: *const u16, flags: u32) -> i32;
        }
        let text: Vec<u16> = "No se pudo abrir Repuestos Félix. Comprueba que no esté abierto, que WebView2 esté instalado y que la carpeta de datos permita escribir.\0".encode_utf16().collect();
        let title: Vec<u16> = "Repuestos Félix\0".encode_utf16().collect();
        unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10); }
    }
}

fn main() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let configured: Result<(), Box<dyn std::error::Error>> = (|| {
                let resources = app.path().resource_dir()?;
                let local = std::env::var_os("LOCALAPPDATA").ok_or("Falta la carpeta local del usuario.")?;
                let data_dir = Path::new(&local).join("RepuestosFelix").join("POS");
                let (server, url) = start_server(&resources, &data_dir)?;
                app.manage(server);
                let origin = url.origin();
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                    .title("Repuestos Félix")
                    .inner_size(1200.0, 850.0)
                    .min_inner_size(760.0, 600.0)
                    .prevent_overflow()
                    .resizable(true)
                    .on_navigation(move |next| next.origin() == origin)
                    .on_new_window(|_, _| NewWindowResponse::Deny)
                    .build()?;
                Ok(())
            })();
            if configured.is_err() {
                show_startup_error();
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
        Err(_) => show_startup_error(),
    }
}

#[cfg(test)]
mod tests {
    use super::{ready_url, start_server};

    #[test]
    #[cfg(windows)]
    fn bundled_server_starts_from_a_canonical_windows_resource_path() {
        let resources = std::fs::canonicalize(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/windows-payload"),
        ).unwrap();
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let data = std::env::temp_dir().join(format!("felix-native-start-{}-{unique}", std::process::id()));
        let outcome = start_server(&resources, &data);
        if let Ok((server, _)) = &outcome { server.stop(); }
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
}
