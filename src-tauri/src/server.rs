use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

// Server state - tracks the running server so we can shut it down
static SERVER_SHUTDOWN: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
static SERVER_PORT: Mutex<Option<u16>> = Mutex::new(None);

/// Determine the correct Content-Type for a file based on its extension.
fn content_type_for(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".xml") {
        "application/xml; charset=utf-8"
    } else if lower.ends_with(".txt") {
        "text/plain; charset=utf-8"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".pdf") {
        "application/pdf"
    } else if lower.ends_with(".wasm") {
        "application/wasm"
    } else {
        "application/octet-stream"
    }
}

/// Handler that serves static files from the project directory.
async fn serve_file(
    State(root): State<Arc<PathBuf>>,
    request: axum::extract::Request,
) -> Response {
    let req_path = request.uri().path().trim_start_matches('/');

    // Build the file path, default to index.html for root
    let file_path = if req_path.is_empty() {
        root.join("index.html")
    } else {
        let joined = root.join(req_path);
        if joined.is_dir() {
            joined.join("index.html")
        } else {
            joined
        }
    };

    // Security: make sure resolved path is within the project root
    let canonical = match file_path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        }
    };
    let root_canonical = match root.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Server error").into_response();
        }
    };
    if !canonical.starts_with(&root_canonical) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    // Read the file
    let bytes = match tokio::fs::read(&canonical).await {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        }
    };

    let path_str = canonical.to_string_lossy();
    let ct = content_type_for(&path_str);

    // For HTML files, use axum's Html wrapper to guarantee text/html
    if ct.starts_with("text/html") {
        match String::from_utf8(bytes) {
            Ok(html_string) => Html(html_string).into_response(),
            Err(e) => {
                (
                    StatusCode::OK,
                    [("content-type", ct), ("cache-control", "no-cache")],
                    e.into_bytes(),
                ).into_response()
            }
        }
    } else {
        (
            StatusCode::OK,
            [("content-type", ct), ("cache-control", "no-cache")],
            bytes,
        ).into_response()
    }
}

/// Start a static file server for the given project directory.
pub async fn start(project_path: &str, preferred_port: u16) -> Result<u16, String> {
    // Stop any existing server first
    stop();

    let path = PathBuf::from(project_path);
    if !path.exists() || !path.is_dir() {
        return Err("Invalid project path".to_string());
    }

    let root = Arc::new(path);

    let app = Router::new()
        .fallback(serve_file)
        .with_state(root);

    // Try preferred port first, fall back to port 0 (OS picks available port)
    let listener = match tokio::net::TcpListener::bind(
        SocketAddr::from(([127, 0, 0, 1], preferred_port))
    ).await {
        Ok(l) => l,
        Err(_) => {
            tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
                .await
                .map_err(|e| format!("Failed to bind any port: {}", e))?
        }
    };

    let actual_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    *SERVER_SHUTDOWN.lock().unwrap() = Some(shutdown_tx);
    *SERVER_PORT.lock().unwrap() = Some(actual_port);

    Ok(actual_port)
}

/// Stop the running preview server.
pub fn stop() {
    if let Some(tx) = SERVER_SHUTDOWN.lock().unwrap().take() {
        let _ = tx.send(());
    }
    *SERVER_PORT.lock().unwrap() = None;
}

/// Get the port of the currently running server, if any.
pub fn get_port() -> Option<u16> {
    *SERVER_PORT.lock().unwrap()
}