// ============================================================
// oauth.rs
// ============================================================
// OAuth callback server for all assistant integrations.
//
// How it works:
// 1. Frontend calls a Tauri command (e.g. start_gmail_oauth)
// 2. This module starts a TCP server on 127.0.0.1:49580
// 3. Opens the user's browser to the provider's OAuth URL
// 4. User signs in, provider redirects to http://127.0.0.1:49580
// 5. Server captures the auth code, exchanges it for tokens
// 6. Returns tokens + user info to the frontend
// 7. Server shuts down
//
// Fixed port: 49580 (private range 49152-65535, no IANA assignment)
// Same port for every user — registered once in their OAuth app settings.
//
// Dependencies (add to Cargo.toml if not already present):
//   open = "5"
//   (reqwest, chrono, serde, serde_json — already in Cargo.toml)

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

/// Fixed OAuth callback port. Private range (49152-65535), not assigned by IANA.
/// Every user registers this same port in their OAuth app redirect URLs.
const OAUTH_PORT: u16 = 49580;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthResult {
    pub email: String,
    pub display_name: Option<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
}


/// Start a temporary TCP server, wait for the OAuth callback,
/// and return the authorization code from the query string.
fn wait_for_callback(port: u16) -> Result<String, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .map_err(|_| "Another application is using the connection port (49580). Please close it and try again.".to_string())?;

    // 5-minute timeout
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set socket options: {}", e))?;

    // Accept one connection with a timeout
    // We use a loop with short accepts and check elapsed time
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(300);

    let mut stream = loop {
        // Set a short accept timeout by making the listener non-blocking
        // and sleeping between attempts
        listener.set_nonblocking(true).ok();
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > timeout {
                    return Err("OAuth timed out — no response received within 5 minutes. Please try again.".to_string());
                }
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("Failed to accept connection: {}", e)),
        }
    };

    // Read the HTTP request
    let mut buf = [0u8; 4096];
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let n = stream.read(&mut buf).map_err(|e| format!("Failed to read request: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]).to_string();

    // Parse the request line to get the path: "GET /path?query HTTP/1.1"
    let request_line = request.lines().next().unwrap_or("");
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");

    // Parse query parameters using reqwest::Url
    let full_url = format!("http://127.0.0.1:{}{}", port, path);
    let parsed = reqwest::Url::parse(&full_url)
        .map_err(|e| format!("Failed to parse callback URL: {}", e))?;

    // Extract the authorization code
    let code = parsed
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .ok_or_else(|| {
            let error = parsed
                .query_pairs()
                .find(|(key, _)| key == "error")
                .map(|(_, value)| value.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            format!("OAuth was cancelled or failed: {}", error)
        })?;

    // Send a nice HTML response to the browser
    let response_html = concat!(
        "<html><body style=\"font-family:-apple-system,sans-serif;display:flex;justify-content:center;",
        "align-items:center;height:100vh;margin:0;background:#2F3238;color:#DCE0E4;\">",
        "<div style=\"text-align:center;\">",
        "<div style=\"font-size:48px;margin-bottom:16px;\">&#10003;</div>",
        "<h2 style=\"margin:0 0 8px;font-weight:600;\">Connected!</h2>",
        "<p style=\"color:#9CA3AF;font-size:14px;\">You can close this window and return to Omnirun.</p>",
        "</div></body></html>"
    );

    let http_response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response_html.len(),
        response_html
    );
    let _ = stream.write_all(http_response.as_bytes());
    let _ = stream.flush();

    Ok(code)
}

/// Build the OAuth authorization URL for a given provider.
fn build_auth_url(
    provider: &str,
    client_id: &str,
    scopes: &[String],
    redirect_uri: &str,
) -> Result<String, String> {
    let (base_url, scope_separator) = match provider {
        "gmail" | "google_calendar" => (
            "https://accounts.google.com/o/oauth2/v2/auth",
            " ",
        ),
        "outlook" | "outlook_calendar" => (
            "https://login.microsoftonline.com/common/oauth2/v2/authorize",
            " ",
        ),
        "slack" => ("https://slack.com/oauth/v2/authorize", ","),
        "discord" => ("https://discord.com/api/oauth2/authorize", " "),
        "github" => ("https://github.com/login/oauth/authorize", " "),
        "notion" => ("https://api.notion.com/v1/oauth/authorize", " "),
        "todoist" => ("https://todoist.com/oauth/authorize", ","),
        _ => return Err(format!("Unknown OAuth provider: {}", provider)),
    };

    let scope_str = scopes.join(scope_separator);

    let mut params: Vec<(&str, String)> = vec![
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("response_type", "code".to_string()),
        ("scope", scope_str),
    ];

    // Provider-specific extras
    match provider {
        "gmail" | "google_calendar" => {
            params.push(("access_type", "offline".to_string()));
            params.push(("prompt", "consent".to_string()));
        }
        "notion" => {
            params.push(("owner", "user".to_string()));
        }
        _ => {}
    }

    let url = reqwest::Url::parse_with_params(base_url, &params)
        .map_err(|e| format!("Failed to build auth URL: {}", e))?;

    Ok(url.to_string())
}

/// Exchange an authorization code for tokens.
async fn exchange_code(
    provider: &str,
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<(String, Option<String>, Option<String>), String> {
    let token_url = match provider {
        "gmail" | "google_calendar" => "https://oauth2.googleapis.com/token",
        "outlook" | "outlook_calendar" => "https://login.microsoftonline.com/common/oauth2/v2/token",
        "slack" => "https://slack.com/api/oauth.v2.access",
        "discord" => "https://discord.com/api/v10/oauth2/token",
        "github" => "https://github.com/login/oauth/access_token",
        "notion" => "https://api.notion.com/v1/oauth/token",
        "todoist" => "https://todoist.com/oauth/access_token",
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let client = reqwest::Client::new();

    let body: serde_json::Value = if provider == "notion" {
        // Notion uses Basic auth for client credentials
        client
            .post(token_url)
            .basic_auth(client_id, Some(client_secret))
            .json(&serde_json::json!({
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            }))
            .send()
            .await
            .map_err(|e| format!("Token exchange request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?
    } else {
        let mut req = client.post(token_url).form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
        ]);

        // GitHub needs Accept header for JSON response
        if provider == "github" {
            req = req.header("Accept", "application/json");
        }

        req.send()
            .await
            .map_err(|e| format!("Token exchange request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?
    };

    // Slack has a different response format
    if provider == "slack" {
        let access_token = body["authed_user"]["access_token"]
            .as_str()
            .or_else(|| body["access_token"].as_str())
            .ok_or_else(|| format!("No access token in Slack response: {:?}", body))?
            .to_string();
        return Ok((access_token, None, None));
    }

    let access_token = body["access_token"]
        .as_str()
        .ok_or_else(|| {
            let error = body["error"].as_str().unwrap_or("unknown");
            let desc = body["error_description"].as_str().unwrap_or("");
            format!("Token exchange failed: {} {}", error, desc)
        })?
        .to_string();

    let refresh_token = body["refresh_token"].as_str().map(|s| s.to_string());

    let expires_at = body["expires_in"].as_i64().map(|secs| {
        let dt = chrono::Utc::now() + chrono::Duration::seconds(secs);
        dt.to_rfc3339()
    });

    Ok((access_token, refresh_token, expires_at))
}

/// Fetch the user's email and display name using the access token.
async fn fetch_user_info(
    provider: &str,
    access_token: &str,
) -> Result<(String, Option<String>), String> {
    let client = reqwest::Client::new();

    match provider {
        "gmail" | "google_calendar" => {
            let resp: serde_json::Value = client
                .get("https://www.googleapis.com/oauth2/v2/userinfo")
                .bearer_auth(access_token)
                .send().await.map_err(|e| format!("Failed to fetch Google user info: {}", e))?
                .json().await.map_err(|e| format!("Failed to parse Google user info: {}", e))?;
            Ok((
                resp["email"].as_str().unwrap_or("").to_string(),
                resp["name"].as_str().map(|s| s.to_string()),
            ))
        }
        "outlook" | "outlook_calendar" => {
            let resp: serde_json::Value = client
                .get("https://graph.microsoft.com/v1.0/me")
                .bearer_auth(access_token)
                .send().await.map_err(|e| format!("Failed to fetch Microsoft user info: {}", e))?
                .json().await.map_err(|e| format!("Failed to parse Microsoft user info: {}", e))?;
            let email = resp["mail"].as_str()
                .or_else(|| resp["userPrincipalName"].as_str())
                .unwrap_or("").to_string();
            Ok((email, resp["displayName"].as_str().map(|s| s.to_string())))
        }
        "slack" => {
            let resp: serde_json::Value = client
                .get("https://slack.com/api/users.identity")
                .bearer_auth(access_token)
                .send().await.map_err(|e| format!("Failed to fetch Slack user info: {}", e))?
                .json().await.map_err(|e| format!("Failed to parse Slack user info: {}", e))?;
            Ok((
                resp["user"]["email"].as_str().unwrap_or("").to_string(),
                resp["user"]["name"].as_str().map(|s| s.to_string()),
            ))
        }
        "discord" => {
            let resp: serde_json::Value = client
                .get("https://discord.com/api/v10/users/@me")
                .bearer_auth(access_token)
                .send().await.map_err(|e| format!("Failed to fetch Discord user info: {}", e))?
                .json().await.map_err(|e| format!("Failed to parse Discord user info: {}", e))?;
            Ok((
                resp["email"].as_str().unwrap_or("").to_string(),
                resp["global_name"].as_str().or_else(|| resp["username"].as_str()).map(|s| s.to_string()),
            ))
        }
        "github" => {
            let resp: serde_json::Value = client
                .get("https://api.github.com/user")
                .bearer_auth(access_token)
                .header("User-Agent", "Omnirun")
                .send().await.map_err(|e| format!("Failed to fetch GitHub user info: {}", e))?
                .json().await.map_err(|e| format!("Failed to parse GitHub user info: {}", e))?;

            // GitHub may hide email — try /user/emails endpoint
            let mut email = resp["email"].as_str().unwrap_or("").to_string();
            if email.is_empty() {
                let emails: Vec<serde_json::Value> = client
                    .get("https://api.github.com/user/emails")
                    .bearer_auth(access_token)
                    .header("User-Agent", "Omnirun")
                    .send().await.map_err(|e| format!("Failed to fetch GitHub emails: {}", e))?
                    .json().await.unwrap_or_default();
                email = emails.iter()
                    .find(|e| e["primary"].as_bool() == Some(true))
                    .or_else(|| emails.first())
                    .and_then(|e| e["email"].as_str())
                    .unwrap_or("").to_string();
            }
            Ok((email, resp["name"].as_str().map(|s| s.to_string())))
        }
        "notion" => {
            // Notion returns user info in the token exchange response.
            // For now, return a placeholder — caller should extract from token response.
            Ok(("notion-user".to_string(), Some("Notion".to_string())))
        }
        "todoist" => {
            // Try sync API for user info; if it fails, return placeholder
            // (the access token is what matters — user info is cosmetic)
            let result = client
                .post("https://api.todoist.com/sync/v9/sync")
                .bearer_auth(access_token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body("resource_types=[\"user\"]")
                .send().await;
            match result {
                Ok(response) => {
                    if let Ok(resp) = response.json::<serde_json::Value>().await {
                        let email = resp["user"]["email"].as_str().unwrap_or("todoist-user").to_string();
                        let name = resp["user"]["full_name"].as_str().map(|s| s.to_string());
                        Ok((email, name))
                    } else {
                        Ok(("todoist-user".to_string(), Some("Todoist".to_string())))
                    }
                }
                Err(_) => Ok(("todoist-user".to_string(), Some("Todoist".to_string()))),
            }
        }
        _ => Err(format!("Unknown provider for user info: {}", provider)),
    }
}

/// Main OAuth flow — called by each Tauri command below.
async fn run_oauth_flow(
    provider: &str,
    client_id: String,
    client_secret: String,
    scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    // 1. Fixed port — same for every user, registered in their OAuth app settings
    let port = OAUTH_PORT;
    let redirect_uri = match provider {
        "slack" | "notion" => "https://oauth-redirect.omnirun-app.workers.dev".to_string(),
        _ => format!("http://127.0.0.1:{}", port),
    };

    // 2. Build the authorization URL
    let auth_url = build_auth_url(provider, &client_id, &scopes, &redirect_uri)?;

    // 3. Open the user's browser
    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {}", e))?;

    // 4. Wait for the OAuth callback (blocking, so spawn on blocking thread)
    let code = tokio::task::spawn_blocking(move || wait_for_callback(port))
        .await
        .map_err(|e| format!("OAuth callback task failed: {}", e))??;

    // 5. Exchange authorization code for tokens
    let (access_token, refresh_token, expires_at) =
        exchange_code(provider, &client_id, &client_secret, &code, &redirect_uri).await?;

    // 6. Fetch user info (email + display name)
    let (email, display_name) = fetch_user_info(provider, &access_token).await?;

    Ok(OAuthResult {
        email,
        display_name,
        access_token,
        refresh_token,
        expires_at,
    })
}

// ─── Tauri commands ───────────────────────────────────────────
// One per provider. All delegate to run_oauth_flow.

#[tauri::command]
pub async fn start_gmail_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("gmail", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_outlook_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("outlook", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_google_calendar_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("google_calendar", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_outlook_calendar_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("outlook_calendar", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_slack_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("slack", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_discord_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("discord", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_github_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("github", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_notion_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("notion", client_id, client_secret, scopes).await
}

#[tauri::command]
pub async fn start_todoist_oauth(
    client_id: String, client_secret: String, scopes: Vec<String>,
) -> Result<OAuthResult, String> {
    run_oauth_flow("todoist", client_id, client_secret, scopes).await
}