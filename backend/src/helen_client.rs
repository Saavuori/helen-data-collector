use reqwest::{
    cookie::{CookieStore, Jar},
    redirect::Policy,
    Client,
};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Europe::Helsinki;
use regex::Regex;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HELEN_API_BASE: &str = "https://api.omahelen.fi/v25";
const HELEN_OMA_API_V26: &str = "https://api.oma.helen.fi/v26";
const HELEN_LOGIN_HOST: &str = "https://login.helen.fi";
const TUPAS_LOGIN_URL: &str =
    "https://www.helen.fi/hcc/TupasLoginFrame?service=account&locale=fi";
const LOGIN_API_VERSION: &str = "v21";

/// Every Helen call runs while the handler holds the one `AppState` lock, so a
/// request that never answers would freeze the whole app, background tasks
/// included. Each request of the login flow and each API call gets this long.
const HELEN_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The SSO flow takes a handful of hops; more than this means a loop.
const MAX_REDIRECTS: usize = 20;

/// Error text for a missing access-token cookie. The handlers look for it to
/// decide that the session expired and a re-login is worth a try.
pub const NO_ACCESS_TOKEN: &str = "No access token";

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    Quarter,
    Hour,
    Day,
    Month,
}

impl Resolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Resolution::Quarter => "quarter",
            Resolution::Hour    => "hour",
            Resolution::Day     => "day",
            Resolution::Month   => "month",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumptionData {
    pub gsrn:   Option<String>,
    pub series: Vec<ConsumptionSeries>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumptionSeries {
    pub start:                        Option<DateTime<Utc>>,
    pub stop:                         Option<DateTime<Utc>>,
    /// Consumption in kWh for the interval
    pub electricity:                  Option<f64>,
    /// Spot price excluding VAT (c/kWh)
    pub electricity_spot_prices:      Option<f64>,
    /// Spot price including VAT (c/kWh)
    pub electricity_spot_prices_vat:  Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementsResponse {
    pub ids:    Option<MeasurementsIds>,
    pub series: Vec<ConsumptionSeries>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementsIds {
    pub electricity:                  Option<String>,
    pub electricity_spot_prices:      Option<String>,
    pub electricity_spot_prices_vat:  Option<String>,
}

// ---------------------------------------------------------------------------
// HelenClient
// ---------------------------------------------------------------------------

pub struct HelenClient {
    jar:               Arc<Jar>,
    client:            Client,
    selected_contract: Option<serde_json::Value>,
    selected_gsrn:     Option<String>,
}

impl HelenClient {
    pub fn new() -> Result<Self> {
        let (jar, client) = Self::build_client()?;
        Ok(Self {
            jar,
            client,
            selected_contract: None,
            selected_gsrn: None,
        })
    }

    pub fn set_selected_gsrn(&mut self, gsrn: Option<String>) {
        self.selected_gsrn = gsrn;
    }

    pub async fn select_gsrn(&mut self, gsrn: Option<String>) -> Result<()> {
        self.selected_gsrn = gsrn;
        self.refresh_state().await?;
        Ok(())
    }

    /// Build a fresh reqwest Client with its own cookie jar.
    /// Auto-redirect is DISABLED so we can follow Location headers manually,
    /// matching Python's `_follow_redirects`.
    fn build_client() -> Result<(Arc<Jar>, Client)> {
        let jar = Arc::new(Jar::default());
        let client = Client::builder()
            .cookie_provider(Arc::clone(&jar))
            .redirect(Policy::none())
            .timeout(HELEN_REQUEST_TIMEOUT)
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
                 AppleWebKit/537.36 (KHTML, like Gecko) \
                 Chrome/120.0.0.0 Safari/537.36",
            )
            .build()?;
        Ok((jar, client))
    }

    // -----------------------------------------------------------------------
    // Login
    // Mirrors HelenSession.login() -> _send_login_request() ->
    //          _proceed_to_main_page_from_login_response()
    // -----------------------------------------------------------------------

    pub async fn login(&mut self, username: &str, password: &str) -> Result<()> {
        tracing::info!("Starting login for {}", username);

        // Fresh client + jar on every login call — matches Python's
        // `self._session = Session()` at the top of HelenSession.login()
        let (jar, client) = Self::build_client()?;
        self.jar    = jar;
        self.client = client;

        // --- _send_login_request --------------------------------------------

        // 1. GET TupasLoginFrame, read form action + method
        let tupas_body = self
            .request_following_redirects(TUPAS_LOGIN_URL, "GET", None, None)
            .await?;
        let (auth_url, auth_method) = Self::parse_form_action_and_method(&tupas_body)?;
        tracing::info!("Auth URL: {} ({})", auth_url, auth_method);

        // 2. Call the authorization URL with its own method
        let auth_body = self
            .request_following_redirects(&auth_url, &auth_method, None, None)
            .await?;

        // 3. POST credentials — action may be a path so prepend login host
        let (login_path, _) = Self::parse_form_action_and_method(&auth_body)?;
        let login_url = if login_path.starts_with("http") {
            login_path
        } else {
            format!("{}{}", HELEN_LOGIN_HOST, login_path)
        };
        tracing::info!("Login URL: {}", login_url);

        let login_payload = [("username", username), ("password", password)];
        let login_body = self
            .request_following_redirects(&login_url, "POST", Some(&login_payload), None)
            .await?;

        // --- _proceed_to_main_page_from_login_response ----------------------

        // Step A: GET continue_url with code + state params
        let (continue_url, _) = Self::parse_form_action_and_method(&login_body)?;
        let code  = Self::parse_input_value(&login_body, "code")?;
        let state = Self::parse_input_value(&login_body, "state")?;
        let continue_params = [("code", code.as_str()), ("state", state.as_str())];
        tracing::info!("Step A: {}", continue_url);

        let proceed_body = self
            .request_following_redirects(&continue_url, "GET", None, Some(&continue_params))
            .await?;

        // Step B: follow the <a href=...> after fixing the URL
        let proceed_link = Self::parse_first_link(&proceed_body)?;
        let fixed_link   = Self::fix_oma_helen_api_url(&proceed_link);
        tracing::info!("Step B: {}", fixed_link);

        let auth_resp_body = self
            .request_following_redirects(&fixed_link, "GET", None, None)
            .await?;

        // Step C: final GET with code + state
        let (final_url, _) = Self::parse_form_action_and_method(&auth_resp_body)?;
        let final_code  = Self::parse_input_value(&auth_resp_body, "code")?;
        let final_state = Self::parse_input_value(&auth_resp_body, "state")?;
        let final_params = [
            ("code",  final_code.as_str()),
            ("state", final_state.as_str()),
        ];
        tracing::info!("Step C: {}", final_url);

        self.request_following_redirects(&final_url, "GET", None, Some(&final_params))
            .await?;

        // Verify token landed in the cookie jar
        self.get_token()
            .context("Login flow completed but no access-token cookie found — wrong credentials?")?;

        self.refresh_state().await?;

        tracing::info!("Login successful");
        Ok(())
    }

    // -----------------------------------------------------------------------
    // HTTP helpers  (mirror _make_url_request + _follow_redirects)
    // -----------------------------------------------------------------------

    /// Send a request and manually follow Location-header redirects.
    /// After any redirect we switch to GET (matches requests library behaviour).
    async fn request_following_redirects(
        &self,
        url:       &str,
        method:    &str,
        form_data: Option<&[(&str, &str)]>,
        params:    Option<&[(&str, &str)]>,
    ) -> Result<String> {
        let mut current_url    = url.to_string();
        let mut current_method = method.to_uppercase();
        let mut first          = true;

        for _ in 0..=MAX_REDIRECTS {
            let mut req = match current_method.as_str() {
                "POST" => self.client.post(&current_url),
                _      => self.client.get(&current_url),
            };

            // Only attach body/params on the first request
            if first {
                if let Some(p) = params    { req = req.query(p); }
                if let Some(f) = form_data { req = req.form(f);  }
                first = false;
            }

            let resp   = req.send().await?;
            let status = resp.status();
            tracing::debug!("{} {} -> {}", current_method, current_url, status);

            if status.is_redirection() {
                let location = resp
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
                    .context("Redirect with no Location header")?;

                current_method = "GET".to_string();
                current_url = if location.starts_with("http") {
                    location
                } else {
                    reqwest::Url::parse(&current_url)?
                        .join(&location)?
                        .to_string()
                };
                continue;
            }

            if !status.is_success() {
                let body = resp.text().await?;
                return Err(anyhow!(
                    "Request failed ({}) at {}: {}",
                    status, current_url, body
                ));
            }

            return Ok(resp.text().await?);
        }
        Err(anyhow!("Gave up after {} redirects, last at {}", MAX_REDIRECTS, current_url))
    }

    // -----------------------------------------------------------------------
    // HTML parsing helpers
    // -----------------------------------------------------------------------

    /// Returns (action_url, method) from the first <form>.
    fn parse_form_action_and_method(html: &str) -> Result<(String, String)> {
        let doc  = Html::parse_document(html);
        let sel  = Selector::parse("form").unwrap();
        let form = doc.select(&sel).next().context("No <form> in page")?;

        let action_url = form.value().attr("action")
            .context("Form has no action attribute")?
            .to_string();

        let method = form.value().attr("method")
            .unwrap_or("GET")
            .to_uppercase();

        Ok((action_url, method))
    }

    /// Returns the value of `<input name="NAME">`.
    fn parse_input_value(html: &str, name: &str) -> Result<String> {
        let doc = Html::parse_document(html);
        let sel = Selector::parse(&format!("input[name='{}']", name)).unwrap();
        doc.select(&sel)
            .next()
            .and_then(|el| el.value().attr("value"))
            .map(|s| s.to_string())
            .with_context(|| format!("No <input name='{}'> in page", name))
    }

    /// Returns the href of the first <a> tag.
    fn parse_first_link(html: &str) -> Result<String> {
        let doc = Html::parse_document(html);
        let sel = Selector::parse("a").unwrap();
        doc.select(&sel)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|s| s.to_string())
            .context("No <a href=...> in page")
    }

    /// Mirrors Python's `_fix_oma_helen_api_url`:
    /// replace `/vNN/` with `/v21/` and `omahelen` → `oma.helen`.
    fn fix_oma_helen_api_url(url: &str) -> String {
        let re = Regex::new(r"/v\d+/").unwrap();
        re.replace(url, format!("/{}/", LOGIN_API_VERSION).as_str())
            .replace("omahelen", "oma.helen")
    }

    // -----------------------------------------------------------------------
    // Token
    // -----------------------------------------------------------------------

    fn get_token(&self) -> Option<String> {
        for domain in [
            "https://api.omahelen.fi",
            "https://oma.helen.fi",
            "https://www.helen.fi",
            "https://login.helen.fi",
        ] {
            let Ok(url) = domain.parse::<reqwest::Url>() else { continue };
            let Some(cookies) = self.jar.cookies(&url) else { continue };
            let Ok(s) = cookies.to_str() else { continue };
            for part in s.split(';').map(str::trim) {
                for prefix in ["access-token=", "access_token="] {
                    if let Some(token) = part.strip_prefix(prefix) {
                        // Runs before every API call; keep it out of the info log.
                        tracing::debug!("Found token on {}", domain);
                        return Some(token.to_string());
                    }
                }
            }
        }
        tracing::warn!("No access token found in cookie jar");
        None
    }

    // -----------------------------------------------------------------------
    // Contract helpers
    // -----------------------------------------------------------------------

    async fn refresh_state(&mut self) -> Result<()> {
        let contracts = self.fetch_contracts().await?;
        let active    = Self::filter_active_contracts(&contracts);
        let selected = if let Some(ref target_gsrn) = self.selected_gsrn {
            active.iter()
                .find(|c| c["gsrn"].as_str() == Some(target_gsrn))
                .cloned()
                .or_else(|| Self::latest_contract(active.clone()))
        } else {
            Self::latest_contract(active.clone())
        };
        let selected = selected.context("No active contracts found")?;
        tracing::info!(
            "Selected contract GSRN: {}",
            selected["gsrn"].as_str().unwrap_or("?")
        );
        self.selected_contract = Some(selected);
        Ok(())
    }

    pub async fn fetch_contracts(&self) -> Result<Vec<serde_json::Value>> {
        let token = self.get_token().context(NO_ACCESS_TOKEN)?;
        let url   = format!("{}/contract/list", HELEN_API_BASE);

        let res = self.client.get(&url)
            .query(&[
                ("include_transfer", "true"),
                ("update",           "true"),
                ("include_products", "true"),
            ])
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send().await?;

        let status = res.status();
        let body   = res.text().await?;
        if !status.is_success() {
            return Err(anyhow!("Contract list failed ({}): {}", status, body));
        }

        let json: serde_json::Value = serde_json::from_str(&body)?;
        Ok(json["contracts"]
            .as_array()
            .context("No 'contracts' array in response")?
            .to_owned())
    }

    pub fn filter_active_contracts(contracts: &[serde_json::Value]) -> Vec<serde_json::Value> {
        let now = Utc::now().naive_utc();
        let mut active: Vec<serde_json::Value> = contracts.iter().filter(|c| {
            let started = c["start_date"].as_str()
                .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok())
                .map(|d| d <= now)
                .unwrap_or(false);
            if !started { return false; }

            let ended = c["end_date"].as_str()
                .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok())
                .map(|d| d < now)
                .unwrap_or(false);
            if ended { return false; }

            c["domain"].as_str() != Some("electricity-production")
        }).cloned().collect();

        // Sort: prioritize "electricity" over other domains (like "electricity-transfer"),
        // then sort by start_date descending (latest first).
        active.sort_by(|a, b| {
            let a_is_elec = a["domain"].as_str() == Some("electricity");
            let b_is_elec = b["domain"].as_str() == Some("electricity");
            match (a_is_elec, b_is_elec) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => {
                    let a_start = a["start_date"].as_str().unwrap_or("");
                    let b_start = b["start_date"].as_str().unwrap_or("");
                    b_start.cmp(a_start)
                }
            }
        });

        // Deduplicate by GSRN
        let mut seen = std::collections::HashSet::new();
        active.retain(|c| {
            if let Some(gsrn) = c["gsrn"].as_str() {
                seen.insert(gsrn.to_string())
            } else {
                true
            }
        });

        active
    }

    fn latest_contract(mut contracts: Vec<serde_json::Value>) -> Option<serde_json::Value> {
        contracts.sort_by(|a, b| {
            b["start_date"].as_str().unwrap_or("")
                .cmp(a["start_date"].as_str().unwrap_or(""))
        });
        contracts.into_iter().next()
    }

    pub fn gsrn(&self) -> Result<String> {
        self.selected_contract.as_ref()
            .and_then(|c| c["gsrn"].as_str())
            .map(|s| s.to_string())
            .context("No selected contract — call login() first")
    }

    pub fn contract_id(&self) -> Result<String> {
        self.selected_contract.as_ref()
            .and_then(|c| {
                // Helen returns the numeric contract id in the "contract_id" field
                c["contract_id"].as_u64().map(|v| v.to_string())
                    .or_else(|| c["contract_id"].as_str().map(|s| s.to_string()))
            })
            .context("No contract_id in selected contract")
    }

    // -----------------------------------------------------------------------
    // Data fetching
    // -----------------------------------------------------------------------

    pub async fn get_consumption(
        &self,
        start:      NaiveDate,
        stop:       NaiveDate,
        resolution: Resolution,
    ) -> Result<ConsumptionData> {
        let gsrn  = self.gsrn()?;
        let token = self.get_token().context(NO_ACCESS_TOKEN)?;
        let (start_utc, stop_utc) = Self::fi_date_range_to_utc(start, stop)?;

        let url = format!("{}/chart-data/{}/electricity", HELEN_API_BASE, gsrn);
        tracing::info!("Fetching consumption from {}", url);

        let res = self.client.get(&url)
            .query(&[
                ("start",      start_utc.to_rfc3339()),
                ("stop",       stop_utc.to_rfc3339()),
                ("resolution", resolution.as_str().to_string()),
                ("channel",    "oh".to_string()),
            ])
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send().await?;

        let status = res.status();
        let body   = res.text().await?;
        tracing::debug!("Helen API raw response body: {}", body);
        if !status.is_success() {
            return Err(anyhow!("Consumption fetch failed ({}): {}", status, body));
        }

        let raw: MeasurementsResponse = serde_json::from_str(&body)
            .with_context(|| format!("Failed to decode consumption JSON: {}", body))?;

        let parsed_gsrn = raw.ids.as_ref()
            .and_then(|ids| ids.electricity.clone())
            .or_else(|| self.gsrn().ok());

        Ok(ConsumptionData {
            gsrn: parsed_gsrn,
            series: raw.series,
        })
    }

    pub async fn get_products(&self) -> Result<serde_json::Value> {
        let token       = self.get_token().context(NO_ACCESS_TOKEN)?;
        let contract_id = self.contract_id()?;
        let url         = format!("{}/contract/{}/products", HELEN_OMA_API_V26, contract_id);
        tracing::info!("Fetching products from {}", url);

        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send().await?;

        let status = res.status();
        let body   = res.text().await?;
        if !status.is_success() {
            return Err(anyhow!("Products fetch failed ({}): {}", status, body));
        }

        serde_json::from_str(&body)
            .with_context(|| format!("Failed to decode products JSON: {}", body))
    }

    // -----------------------------------------------------------------------
    // Time helpers
    // -----------------------------------------------------------------------

    /// Helsinki calendar days `start..=end` as a half-open UTC range, from the
    /// local midnight that opens `start` to the one that closes `end`.
    fn fi_date_range_to_utc(start: NaiveDate, end: NaiveDate) -> Result<(DateTime<Utc>, DateTime<Utc>)> {
        // Finland changes clocks at 03:00/04:00, so midnight always exists.
        let midnight = |day: NaiveDate| {
            Helsinki
                .from_local_datetime(&day.and_time(NaiveTime::MIN))
                .earliest()
                .map(|t| t.with_timezone(&Utc))
                .context("No Helsinki midnight on that day")
        };
        let after_end = end.succ_opt().context("Stop date out of range")?;
        Ok((midnight(start)?, midnight(after_end)?))
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn utc(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    #[test]
    fn date_range_covers_whole_helsinki_days() {
        let d = |s: &str| s.parse::<NaiveDate>().unwrap();
        // Winter time, UTC+2.
        let (start, stop) = HelenClient::fi_date_range_to_utc(d("2026-01-10"), d("2026-01-10")).unwrap();
        assert_eq!((start, stop), (utc("2026-01-09T22:00:00Z"), utc("2026-01-10T22:00:00Z")));
        // Spring forward on 29 March: the day is 23 hours long.
        let (start, stop) = HelenClient::fi_date_range_to_utc(d("2026-03-29"), d("2026-03-29")).unwrap();
        assert_eq!((start, stop), (utc("2026-03-28T22:00:00Z"), utc("2026-03-29T21:00:00Z")));
        // Fall back on 25 October: 25 hours.
        let (start, stop) = HelenClient::fi_date_range_to_utc(d("2026-10-25"), d("2026-10-25")).unwrap();
        assert_eq!((start, stop), (utc("2026-10-24T21:00:00Z"), utc("2026-10-25T22:00:00Z")));
        assert!(HelenClient::fi_date_range_to_utc(d("2026-01-01"), NaiveDate::MAX).is_err());
    }

    #[test]
    fn active_contracts_are_current_deduplicated_and_supply_first() {
        let day = |offset: i64| (Utc::now() + Duration::days(offset)).format("%Y-%m-%dT%H:%M:%S").to_string();
        let contracts = vec![
            json!({ "gsrn": "A", "domain": "electricity-transfer", "start_date": day(-10) }),
            json!({ "gsrn": "A", "domain": "electricity",          "start_date": day(-400) }),
            json!({ "gsrn": "B", "domain": "electricity",          "start_date": day(-5), "end_date": day(-1) }),
            json!({ "gsrn": "C", "domain": "electricity",          "start_date": day(5) }),
            json!({ "gsrn": "D", "domain": "electricity-production", "start_date": day(-5) }),
            json!({ "gsrn": "E", "domain": "electricity-transfer", "start_date": day(-3) }),
        ];
        let active = HelenClient::filter_active_contracts(&contracts);
        let picked: Vec<_> = active.iter()
            .map(|c| (c["gsrn"].as_str().unwrap(), c["domain"].as_str().unwrap()))
            .collect();
        assert_eq!(picked, [("A", "electricity"), ("E", "electricity-transfer")]);
    }

    #[test]
    fn form_and_link_parsing() {
        let html = r#"<form action="/login?x=1" method="post">
            <input name="code" value="abc"><input name="state" value="xyz"></form>
            <a href="https://api.omahelen.fi/v25/login/callback">go</a>"#;
        assert_eq!(
            HelenClient::parse_form_action_and_method(html).unwrap(),
            ("/login?x=1".to_string(), "POST".to_string())
        );
        assert_eq!(HelenClient::parse_input_value(html, "state").unwrap(), "xyz");
        assert!(HelenClient::parse_input_value(html, "missing").is_err());
        assert_eq!(
            HelenClient::fix_oma_helen_api_url(&HelenClient::parse_first_link(html).unwrap()),
            "https://api.oma.helen.fi/v21/login/callback"
        );
    }

    /// A server that redirects every request back to itself.
    async fn redirect_loop_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new().fallback(|| async {
            axum::response::Redirect::temporary("/again")
        });
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{}/", addr)
    }

    #[tokio::test]
    async fn redirect_loop_is_an_error_not_a_hang() {
        let url = redirect_loop_server().await;
        let client = HelenClient::new().unwrap();
        let err = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            client.request_following_redirects(&url, "GET", None, None),
        )
        .await
        .expect("redirect loop never ended")
        .unwrap_err();
        assert!(err.to_string().contains("redirects"), "{err}");
    }
}
