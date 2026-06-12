mod helen_client;
mod influx;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use helen_client::{HelenClient, ConsumptionData, Resolution};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use chrono::{NaiveDate, TimeZone, Utc, Duration as ChronoDuration};
use chrono_tz::Europe::Helsinki;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    client:           HelenClient,
    logged_in:        bool,
    influx_last_sync: Option<chrono::DateTime<Utc>>,
    influx_error:     Option<String>,
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct ConsumptionQuery {
    start:      NaiveDate,
    stop:       NaiveDate,
    resolution: Option<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    logged_in: bool,
}

#[derive(Serialize)]
struct InfluxStatusResponse {
    enabled:       bool,
    last_sync:     Option<chrono::DateTime<Utc>>,
    next_sync:     Option<chrono::DateTime<Utc>>,
    error:         Option<String>,
}

#[derive(Serialize)]
struct InfluxTestResponse {
    ok:      bool,
    message: String,
}

#[derive(Serialize)]
struct InfluxSyncResponse {
    ok:      bool,
    points:  usize,
    message: String,
}

// ---------------------------------------------------------------------------
// Credentials persistence
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct SavedCredentials {
    username: String,
    password: String,
    selected_gsrn: Option<String>,
}

fn credentials_path() -> PathBuf { PathBuf::from("credentials.json") }

fn save_credentials(username: &str, password: &str, selected_gsrn: Option<String>) {
    let creds = SavedCredentials {
        username: username.to_string(),
        password: password.to_string(),
        selected_gsrn,
    };
    match serde_json::to_string_pretty(&creds) {
        Ok(json) => {
            if let Err(e) = std::fs::write(credentials_path(), json) {
                tracing::warn!("Could not save credentials: {}", e);
            } else {
                tracing::info!("Credentials saved to {}", credentials_path().display());
            }
        }
        Err(e) => tracing::warn!("Could not serialize credentials: {}", e),
    }
}

fn load_credentials() -> Option<SavedCredentials> {
    let data = std::fs::read_to_string(credentials_path()).ok()?;
    serde_json::from_str(&data).ok()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let mut client    = HelenClient::new().expect("Failed to create HelenClient");
    let mut logged_in = false;

    // Auto-login from saved credentials
    if let Some(creds) = load_credentials() {
        tracing::info!("Found saved credentials for '{}', attempting auto-login…", creds.username);
        client.set_selected_gsrn(creds.selected_gsrn.clone());
        match client.login(&creds.username, &creds.password).await {
            Ok(()) => { tracing::info!("Auto-login successful"); logged_in = true; }
            Err(e) => tracing::warn!("Auto-login failed ({}), will require manual login", e),
        }
    } else {
        tracing::info!("No saved credentials found — manual login required");
    }

    let shared_state = Arc::new(Mutex::new(AppState {
        client,
        logged_in,
        influx_last_sync: None,
        influx_error:     None,
    }));

    // ── Background: token refresh every 20 min ─────────────────────────────
    {
        let s = Arc::clone(&shared_state);
        tokio::spawn(async move {
            let interval = tokio::time::Duration::from_secs(20 * 60);
            loop {
                tokio::time::sleep(interval).await;
                tracing::info!("Token refresh: re-logging in…");
                if let Some(creds) = load_credentials() {
                    let mut st = s.lock().await;
                    st.client.set_selected_gsrn(creds.selected_gsrn.clone());
                    match st.client.login(&creds.username, &creds.password).await {
                        Ok(()) => { st.logged_in = true; tracing::info!("Token refresh: success"); }
                        Err(e) => tracing::warn!("Token refresh failed: {}", e),
                    }
                }
            }
        });
    }

    // ── Background: InfluxDB collector ─────────────────────────────────────
    {
        let s = Arc::clone(&shared_state);
        tokio::spawn(async move {
            // Check every 60 seconds; sync when interval has elapsed
            let tick = tokio::time::Duration::from_secs(60);
            loop {
                tokio::time::sleep(tick).await;

                let cfg = influx::load_config();
                if !cfg.enabled { continue; }

                // Is it time to sync?
                let should_sync = {
                    let st = s.lock().await;
                    st.influx_last_sync
                        .map(|t| Utc::now() - t > ChronoDuration::minutes(cfg.interval_minutes as i64))
                        .unwrap_or(true)
                };
                if !should_sync { continue; }

                tracing::info!("InfluxDB collector: starting sync…");
                let result = run_influx_sync(&s, &cfg).await;
                let mut st = s.lock().await;
                match result {
                    Ok(pts) => {
                        st.influx_last_sync = Some(Utc::now());
                        st.influx_error     = None;
                        tracing::info!("InfluxDB collector: wrote {} points", pts);
                    }
                    Err(e) => {
                        st.influx_error = Some(e.to_string());
                        tracing::warn!("InfluxDB collector error: {}", e);
                    }
                }
            }
        });
    }

    let app = Router::new()
        .route("/login",            post(login_handler))
        .route("/status",           get(status_handler))
        .route("/consumption",      get(get_consumption_handler))
        .route("/products",         get(get_products_handler))
        .route("/contracts",        get(get_contracts_handler))
        .route("/contracts/select", post(select_contract_handler))
        .route("/influx/config",    get(get_influx_config_handler).post(post_influx_config_handler))
        .route("/influx/status",    get(get_influx_status_handler))
        .route("/influx/test",      post(influx_test_handler))
        .route("/influx/sync",      post(influx_sync_handler))
        .fallback_service(tower_http::services::ServeDir::new("dist"))
        .layer(CorsLayer::permissive())
        .with_state(shared_state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

// ---------------------------------------------------------------------------
// InfluxDB sync logic (shared between background task and manual trigger)
// ---------------------------------------------------------------------------

/// Collect yesterday + today from Helen and write to InfluxDB.
/// Returns the number of data points written.
async fn run_influx_sync(
    state: &Arc<Mutex<AppState>>,
    cfg:   &influx::InfluxConfig,
) -> anyhow::Result<usize> {
    // Determine "today" and "yesterday" in Helsinki time
    let now_hel   = Utc::now().with_timezone(&Helsinki);
    let today     = now_hel.date_naive();
    let yesterday = today - ChronoDuration::days(1);

    // Grab GSRN without holding lock during network calls
    let gsrn = {
        let st = state.lock().await;
        if !st.logged_in { return Err(anyhow::anyhow!("Not logged in")); }
        st.client.gsrn()?
    };

    // Fetch two days. Hold the lock per fetch (brief re-lock pattern)
    let mut total_lines = String::new();

    for date in [yesterday, today] {
        let series = {
            let st = state.lock().await;
            st.client.get_consumption(date, date, Resolution::Quarter).await?
        };
        let actual_gsrn = series.gsrn.as_ref().unwrap_or(&gsrn);
        let lines = influx::to_line_protocol(actual_gsrn, &series.series);
        if !lines.is_empty() {
            if !total_lines.is_empty() { total_lines.push('\n'); }
            total_lines.push_str(&lines);
        }
    }

    let points = influx::write_points(cfg, &total_lines).await?;
    Ok(points)
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async fn relogin_if_needed(state: &mut AppState) -> bool {
    match load_credentials() {
        Some(creds) => {
            tracing::info!("Access token expired — on-demand re-login…");
            state.client.set_selected_gsrn(creds.selected_gsrn.clone());
            match state.client.login(&creds.username, &creds.password).await {
                Ok(()) => { state.logged_in = true; tracing::info!("Re-login ok"); true }
                Err(e) => { tracing::warn!("Re-login failed: {}", e); false }
            }
        }
        None => { tracing::warn!("Re-login: no credentials.json"); false }
    }
}

// ---------------------------------------------------------------------------
// Handlers — auth
// ---------------------------------------------------------------------------

async fn status_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<StatusResponse> {
    let state = state.lock().await;
    Json(StatusResponse { logged_in: state.logged_in })
}

async fn login_handler(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<LoginRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("Login attempt for {}", payload.username);
    let mut state = state.lock().await;
    let existing = load_credentials();
    let selected_gsrn = existing.and_then(|e| {
        if e.username == payload.username { e.selected_gsrn } else { None }
    });
    
    state.client.set_selected_gsrn(selected_gsrn.clone());
    state.client.login(&payload.username, &payload.password).await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        
    save_credentials(&payload.username, &payload.password, selected_gsrn);
    state.logged_in = true;
    tracing::info!("Login successful");
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// Handlers — Helen data
// ---------------------------------------------------------------------------

async fn get_products_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut state = state.lock().await;
    if !state.logged_in { return Err((StatusCode::UNAUTHORIZED, "Not logged in".into())); }
    match state.client.get_products().await {
        Ok(d) => return Ok(Json(d)),
        Err(e) if e.to_string().contains("No access token") => { relogin_if_needed(&mut state).await; }
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
    state.client.get_products().await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_contracts_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut state = state.lock().await;
    if !state.logged_in { return Err((StatusCode::UNAUTHORIZED, "Not logged in".into())); }
    
    let selected_gsrn = state.client.gsrn().ok();
    
    match state.client.fetch_contracts().await {
        Ok(d) => {
            let active = HelenClient::filter_active_contracts(&d);
            Ok(Json(serde_json::json!({
                "contracts": active,
                "selected_gsrn": selected_gsrn
            })))
        }
        Err(e) if e.to_string().contains("No access token") => {
            relogin_if_needed(&mut state).await;
            let selected_gsrn = state.client.gsrn().ok();
            match state.client.fetch_contracts().await {
                Ok(d) => {
                    let active = HelenClient::filter_active_contracts(&d);
                    Ok(Json(serde_json::json!({
                        "contracts": active,
                        "selected_gsrn": selected_gsrn
                    })))
                }
                Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
            }
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

#[derive(Deserialize)]
struct SelectContractRequest {
    gsrn: String,
}

async fn select_contract_handler(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<SelectContractRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut state = state.lock().await;
    if !state.logged_in { return Err((StatusCode::UNAUTHORIZED, "Not logged in".into())); }
    
    state.client.select_gsrn(Some(payload.gsrn.clone())).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
    if let Some(mut creds) = load_credentials() {
        creds.selected_gsrn = Some(payload.gsrn);
        save_credentials(&creds.username, &creds.password, creds.selected_gsrn);
    }
    
    Ok(StatusCode::OK)
}

async fn get_consumption_handler(
    State(state): State<Arc<Mutex<AppState>>>,
    Query(params): Query<ConsumptionQuery>,
) -> Result<Json<ConsumptionData>, (StatusCode, String)> {
    let mut state = state.lock().await;
    if !state.logged_in { return Err((StatusCode::UNAUTHORIZED, "Not logged in".into())); }

    let resolution = match params.resolution.as_deref() {
        Some("quarter") => Resolution::Quarter,
        Some("day")     => Resolution::Day,
        Some("month")   => Resolution::Month,
        _               => Resolution::Hour,
    };

    match state.client.get_consumption(params.start, params.stop, resolution).await {
        Ok(d) => return Ok(Json(d)),
        Err(e) if e.to_string().contains("No access token") => {
            tracing::warn!("get_consumption token expired, re-logging in");
            relogin_if_needed(&mut state).await;
        }
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }

    state.client.get_consumption(params.start, params.stop, resolution).await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

// ---------------------------------------------------------------------------
// Handlers — InfluxDB configuration
// ---------------------------------------------------------------------------

async fn get_influx_config_handler() -> Json<influx::InfluxConfig> {
    Json(influx::load_config())
}

async fn post_influx_config_handler(
    Json(new_cfg): Json<influx::InfluxConfig>,
) -> Result<StatusCode, (StatusCode, String)> {
    influx::save_config(&new_cfg)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("InfluxDB config saved (enabled={})", new_cfg.enabled);
    Ok(StatusCode::OK)
}

async fn get_influx_status_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<InfluxStatusResponse> {
    let state = state.lock().await;
    let cfg   = influx::load_config();
    let next  = state.influx_last_sync.map(|t| {
        t + ChronoDuration::minutes(cfg.interval_minutes as i64)
    });
    Json(InfluxStatusResponse {
        enabled:   cfg.enabled,
        last_sync: state.influx_last_sync,
        next_sync: next,
        error:     state.influx_error.clone(),
    })
}

async fn influx_test_handler(
    Json(cfg): Json<influx::InfluxConfig>,
) -> Json<InfluxTestResponse> {
    match influx::test_connection(&cfg).await {
        Ok(msg) => Json(InfluxTestResponse { ok: true,  message: msg }),
        Err(e)  => Json(InfluxTestResponse { ok: false, message: e.to_string() }),
    }
}

async fn influx_sync_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<InfluxSyncResponse> {
    let cfg = influx::load_config();
    if cfg.token.is_empty() || cfg.url.is_empty() {
        return Json(InfluxSyncResponse {
            ok: false, points: 0,
            message: "InfluxDB not configured — fill in URL, token, org and bucket first".into(),
        });
    }
    match run_influx_sync(&state, &cfg).await {
        Ok(pts) => {
            let mut st = state.lock().await;
            st.influx_last_sync = Some(Utc::now());
            st.influx_error     = None;
            Json(InfluxSyncResponse { ok: true, points: pts, message: format!("Wrote {} points", pts) })
        }
        Err(e) => {
            let mut st = state.lock().await;
            st.influx_error = Some(e.to_string());
            Json(InfluxSyncResponse { ok: false, points: 0, message: e.to_string() })
        }
    }
}