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

// Element selection overlay state
static SELECTION_MODE: Mutex<bool> = Mutex::new(false);
static PROXY_TARGET: Mutex<Option<u16>> = Mutex::new(None);

/// Toggle element selection overlay injection into HTML responses.
pub fn set_selection_mode(enabled: bool) {
    *SELECTION_MODE.lock().unwrap() = enabled;
}

/// Set or clear the dev server port to proxy to.
/// When set, the static server acts as a reverse proxy to that port.
pub fn set_proxy_target(port: Option<u16>) {
    *PROXY_TARGET.lock().unwrap() = port;
}

/// The selection overlay JavaScript — injected into HTML pages when selection mode is active.
/// Self-contained, no dependencies. Handles hover highlight, click to select,
/// shift+click multi-select, and postMessage back to the parent Tauri app.
const SELECTION_OVERLAY_JS: &str = r#"(function(){
if(window.__omnirunSelectionActive)return;
window.__omnirunSelectionActive=true;

window.addEventListener('message',function(e){
  if(e.data&&e.data.type==='__omnirun-disable-selection')cleanup();
});

function buildSelector(el){
  var parts=[],cur=el;
  while(cur&&cur!==document.body&&cur!==document.documentElement){
    var sel=cur.tagName.toLowerCase();
    if(cur.id){parts.unshift(sel+'#'+cur.id);break;}
    var cls=Array.from(cur.classList).filter(function(c){return!/^(hover|focus|active|__)/.test(c);}).slice(0,3);
    if(cls.length)sel+='.'+cls.join('.');
    var par=cur.parentElement;
    if(par){var sibs=Array.from(par.children).filter(function(s){return s.tagName===cur.tagName;});
    if(sibs.length>1)sel+=':nth-child('+(sibs.indexOf(cur)+1)+')';}
    parts.unshift(sel);cur=cur.parentElement;
  }
  return parts.join(' > ')||el.tagName.toLowerCase();
}

function getStyles(el){
  var s=getComputedStyle(el);
  return{color:s.color,backgroundColor:s.backgroundColor,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,padding:s.padding,margin:s.margin,borderRadius:s.borderRadius};
}

function getText(el){var t=(el.textContent||'').trim();return t.length>80?t.slice(0,80)+'\u2026':t;}

var hDiv=null,tDiv=null,sOvs=[];

function mkH(){
  var d=document.createElement('div');d.id='__omnirun-hover';
  d.style.cssText='position:fixed;pointer-events:none;border:2px solid #2DB87A;background:rgba(45,184,122,0.08);z-index:999999;transition:all .1s;display:none;';
  document.body.appendChild(d);return d;
}
function mkT(){
  var d=document.createElement('div');d.id='__omnirun-tag';
  d.style.cssText='position:fixed;pointer-events:none;background:#2DB87A;color:#fff;font:10px/1 monospace;padding:1px 6px;border-radius:0 0 4px 4px;z-index:1000000;display:none;white-space:nowrap;';
  document.body.appendChild(d);return d;
}
function mkS(r){
  var d=document.createElement('div');d.className='__omnirun-sel';
  d.style.cssText='position:fixed;pointer-events:none;border:2px solid #2DB87A;background:rgba(45,184,122,0.12);z-index:999998;';
  d.style.top=r.top+'px';d.style.left=r.left+'px';d.style.width=r.width+'px';d.style.height=r.height+'px';
  document.body.appendChild(d);return d;
}
function skip(el){
  if(!el||el===document.body||el===document.documentElement)return true;
  return(el.id||'').indexOf('__omnirun-')===0||el.tagName==='SCRIPT'||el.tagName==='STYLE';
}

function onMove(e){
  var el=document.elementFromPoint(e.clientX,e.clientY);
  if(!el||skip(el)){if(hDiv)hDiv.style.display='none';if(tDiv)tDiv.style.display='none';return;}
  if(!hDiv)hDiv=mkH();if(!tDiv)tDiv=mkT();
  var r=el.getBoundingClientRect();
  hDiv.style.top=r.top+'px';hDiv.style.left=r.left+'px';hDiv.style.width=r.width+'px';hDiv.style.height=r.height+'px';hDiv.style.display='block';
  var tag=el.tagName.toLowerCase(),id=el.id?'#'+el.id:'',cls=Array.from(el.classList).slice(0,2).map(function(c){return'.'+c;}).join('');
  tDiv.textContent=tag+id+cls;tDiv.style.top=Math.max(0,r.top-16)+'px';tDiv.style.left=r.left+'px';tDiv.style.display='block';
}

function onClick(e){
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  var el=document.elementFromPoint(e.clientX,e.clientY);
  if(!el||skip(el))return;
  var r=el.getBoundingClientRect();
  if(!e.shiftKey){sOvs.forEach(function(d){d.remove();});sOvs=[];}
  sOvs.push(mkS(r));
  window.parent.postMessage({
    type:'__omnirun-element-selected',
    element:{selector:buildSelector(el),tagName:el.tagName.toLowerCase(),textContent:getText(el),computedStyles:getStyles(el),rect:{top:r.top,left:r.left,width:r.width,height:r.height}},
    multiSelect:e.shiftKey
  },'*');
}

function blockNav(e){e.preventDefault();e.stopPropagation();}

document.body.style.cursor='crosshair';
document.addEventListener('mousemove',onMove,true);
document.addEventListener('click',onClick,true);
document.querySelectorAll('a').forEach(function(a){a.addEventListener('click',blockNav,true);});
document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();e.stopPropagation();},true);});

function cleanup(){
  window.__omnirunSelectionActive=false;
  document.body.style.cursor='';
  document.removeEventListener('mousemove',onMove,true);
  document.removeEventListener('click',onClick,true);
  if(hDiv)hDiv.remove();if(tDiv)tDiv.remove();
  sOvs.forEach(function(d){d.remove();});sOvs=[];
  document.querySelectorAll('a').forEach(function(a){a.removeEventListener('click',blockNav,true);});
}
})();"#;

/// Mouse drag-to-scroll for horizontally scrollable elements.
/// Always injected into HTML previews so Expo/React Native web apps
/// support mouse drag on scrollable containers (they only support touch by default).
/// Only activates on elements that actually have horizontal overflow — no effect on others.
const DRAG_SCROLL_JS: &str = r#"(function(){
if(window.__omnirunDragScroll)return;
window.__omnirunDragScroll=true;
var tgt=null,startX=0,scrollL=0;
function findScrollable(el){
  while(el&&el!==document.body){
    if(el.scrollWidth>el.clientWidth+1){var s=getComputedStyle(el).overflowX;if(s==='auto'||s==='scroll')return el;}
    el=el.parentElement;
  }
  return null;
}
document.addEventListener('mousedown',function(e){
  var s=findScrollable(e.target);if(!s)return;
  tgt=s;startX=e.pageX;scrollL=s.scrollLeft;tgt.style.cursor='grabbing';tgt.style.userSelect='none';
},true);
document.addEventListener('mousemove',function(e){
  if(!tgt)return;e.preventDefault();tgt.scrollLeft=scrollL-(e.pageX-startX);
},true);
document.addEventListener('mouseup',function(){
  if(!tgt)return;tgt.style.cursor='';tgt.style.userSelect='';tgt=null;
},true);
})();"#;

/// Inject the selection overlay script into an HTML string before </body>.
/// Also always injects the drag-scroll helper for mouse-based horizontal scrolling.
fn inject_selection_script(html: String) -> String {
    let tag = format!("\n<script data-omnirun-selection>{}</script>\n", SELECTION_OVERLAY_JS);
    inject_before_closing_tag(html, &tag)
}

/// Inject the drag-scroll script into an HTML string before </body>.
fn inject_drag_scroll_script(html: String) -> String {
    let tag = format!("\n<script data-omnirun-dragscroll>{}</script>\n", DRAG_SCROLL_JS);
    inject_before_closing_tag(html, &tag)
}

/// Helper: inject a script tag before </body> or </html>.
fn inject_before_closing_tag(html: String, tag: &str) -> String {
    if let Some(pos) = html.rfind("</body>") {
        let mut out = html[..pos].to_string();
        out.push_str(tag);
        out.push_str(&html[pos..]);
        out
    } else if let Some(pos) = html.rfind("</html>") {
        let mut out = html[..pos].to_string();
        out.push_str(tag);
        out.push_str(&html[pos..]);
        out
    } else {
        html + tag
    }
}

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

/// Proxy a request to the dev server and return the response.
/// Injects the selection overlay into HTML responses when selection mode is on.
async fn proxy_to_dev_server(target_port: u16, uri: &str) -> Response {
    let url = format!("http://127.0.0.1:{}{}", target_port, uri);

    let client = match reqwest::Client::builder().no_proxy().build() {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("Proxy client error: {}", e)).into_response();
        }
    };

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", e)).into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = resp.bytes().await.unwrap_or_default();

    // For HTML responses, inject drag-scroll helper and optionally selection overlay
    if content_type.contains("text/html") {
        if let Ok(mut html) = String::from_utf8(bytes.to_vec()) {
            html = inject_drag_scroll_script(html);
            if *SELECTION_MODE.lock().unwrap() {
                html = inject_selection_script(html);
            }
            return Response::builder()
                .status(status)
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "no-cache")
                .body(axum::body::Body::from(html))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response());
        }
    }

    // Non-HTML: forward as-is
    Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("cache-control", "no-cache")
        .body(axum::body::Body::from(bytes.to_vec()))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// Handler that serves static files from the project directory,
/// or proxies to a dev server when PROXY_TARGET is set.
async fn serve_file(
    State(root): State<Arc<PathBuf>>,
    request: axum::extract::Request,
) -> Response {
    // ── Proxy mode: forward to dev server ──
    let proxy_target = *PROXY_TARGET.lock().unwrap();
    if let Some(target_port) = proxy_target {
        let uri = request.uri().to_string();
        return proxy_to_dev_server(target_port, &uri).await;
    }

    // ── Static mode: serve files from disk ──
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

    // For HTML files, inject drag-scroll helper and optionally selection overlay
    if ct.starts_with("text/html") {
        match String::from_utf8(bytes) {
            Ok(mut html_string) => {
                html_string = inject_drag_scroll_script(html_string);
                if *SELECTION_MODE.lock().unwrap() {
                    html_string = inject_selection_script(html_string);
                }
                Html(html_string).into_response()
            }
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
    // Note: PROXY_TARGET is NOT cleared here because start() calls stop() internally,
    // and we need the proxy target to survive the restart cycle.
    // It gets cleared explicitly via set_proxy_target(None) when needed.
}

/// Get the port of the currently running server, if any.
pub fn get_port() -> Option<u16> {
    *SERVER_PORT.lock().unwrap()
}