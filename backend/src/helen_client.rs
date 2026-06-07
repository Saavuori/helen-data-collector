use reqwest::{
    cookie::{CookieStore, Jar},
    redirect::Policy,
    Client,
};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
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

// ---------------------------------------------------------------------------
// HelenClient
// ---------------------------------------------------------------------------

pub struct HelenClient {
    jar:               Arc<Jar>,
    client:            Client,
    selected_contract: Option<serde_json::Value>,
    latest_login_time: Option<DateTime<Utc>>,
}

impl HelenClient {
    pub fn new() -> Result<Self> {
        let (jar, client) = Self::build_client()?;
        Ok(Self {
            jar,
            client,
            selected_contract: None,
            latest_login_time: None,
        })
    }

    /// Build a fresh reqwest Client with its own cookie jar.
    /// Auto-redirect is DISABLED so we can follow Location headers manually,
    /// matching Python's `_follow_redirects`.
    fn build_client() -> Result<(Arc<Jar>, Client)> {
        let jar = Arc::new(Jar::default());
        let client = Client::builder()
            .cookie_provider(Arc::clone(&jar))
            .redirect(Policy::none())
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
                 AppleWebKit/537.36 (KHTML, like Gecko) \
                 Chrome/120.0.0.0 Safari/537.36",
            )
            .build()?;
        Ok((jar, client))
    }

    // -----------------------------------------------------------------------
    // Session helpers
    // -----------------------------------------------------------------------

    pub fn is_session_valid(&self) -> bool {
        self.latest_login_time
            .map(|t| Utc::now() - t < Duration::hours(1))
            .unwrap_or(false)
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
        let tupas_body = self.get_following_redirects(TUPAS_LOGIN_URL).await?;
        let (auth_url, auth_method) =
            Self::parse_form_action_and_method(&tupas_body, "")?;
        tracing::info!("Auth URL: {} ({})", auth_url, auth_method);

        // 2. Call the authorization URL with its own method
        let auth_body = self
            .request_following_redirects(&auth_url, &auth_method, None, None)
            .await?;

        // 3. POST credentials — action may be a path so prepend login host
        let (login_path, _) =
            Self::parse_form_action_and_method(&auth_body, "")?;
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
        let (continue_url, _) =
            Self::parse_form_action_and_method(&login_body, "")?;
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
        let (final_url, _) =
            Self::parse_form_action_and_method(&auth_resp_body, "")?;
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

        self.latest_login_time = Some(Utc::now());
        self.refresh_state().await?;

        tracing::info!("Login successful");
        Ok(())
    }

    // -----------------------------------------------------------------------
    // HTTP helpers  (mirror _make_url_request + _follow_redirects)
    // -----------------------------------------------------------------------

    async fn get_following_redirects(&self, url: &str) -> Result<String> {
        self.request_following_redirects(url, "GET", None, None).await
    }

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

        loop {
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
                    .get("location")
                    .or_else(|| resp.headers().get("Location"))
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
    }

    // -----------------------------------------------------------------------
    // HTML parsing helpers
    // -----------------------------------------------------------------------

    /// Returns (action_url, method) from the first <form>.
    fn parse_form_action_and_method(html: &str, base: &str) -> Result<(String, String)> {
        let doc  = Html::parse_document(html);
        let sel  = Selector::parse("form").unwrap();
        let form = doc.select(&sel).next().context("No <form> in page")?;

        let action = form.value().attr("action")
            .context("Form has no action attribute")?;
        let action_url = if action.starts_with("http") || base.is_empty() {
            action.to_string()
        } else {
            format!("{}{}", base, action)
        };

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
            if let Ok(url) = domain.parse::<reqwest::Url>() {
                if let Some(cookies) = self.jar.cookies(&url) {
                    if let Ok(s) = cookies.to_str() {
                        for part in s.split(';').map(str::trim) {
                            for prefix in ["access-token=", "access_token="] {
                                if let Some(token) = part.strip_prefix(prefix) {
                                    tracing::info!("Found token on {}", domain);
                                    return Some(token.to_string());
                                }
                            }
                        }
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
        let selected  = Self::latest_contract(active)
            .context("No active contracts found")?;
        tracing::info!(
            "Selected contract GSRN: {}",
            selected["gsrn"].as_str().unwrap_or("?")
        );
        self.selected_contract = Some(selected);
        Ok(())
    }

    async fn fetch_contracts(&self) -> Result<Vec<serde_json::Value>> {
        let token = self.get_token().context("No access token")?;
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

    fn filter_active_contracts(contracts: &[serde_json::Value]) -> Vec<serde_json::Value> {
        let now = Utc::now().naive_utc();
        contracts.iter().filter(|c| {
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
        }).cloned().collect()
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

    pub fn delivery_site_id(&self) -> Result<String> {
        self.selected_contract.as_ref()
            .and_then(|c| c["delivery_site"]["id"].as_u64())
            .map(|id| id.to_string())
            .context("No delivery_site id in selected contract")
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
        let token = self.get_token().context("No access token")?;
        let (start_utc, stop_utc) = Self::fi_date_range_to_utc(start, stop, true);

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
        if !status.is_success() {
            return Err(anyhow!("Consumption fetch failed ({}): {}", status, body));
        }

        serde_json::from_str(&body)
            .with_context(|| format!("Failed to decode consumption JSON: {}", body))
    }

    pub async fn get_products(&self) -> Result<serde_json::Value> {
        let token       = self.get_token().context("No access token")?;
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

    pub async fn get_measurements(
        &self,
        start:      NaiveDate,
        stop:       NaiveDate,
        resolution: Resolution,
    ) -> Result<serde_json::Value> {
        let token            = self.get_token().context("No access token")?;
        let delivery_site_id = self.delivery_site_id()?;
        let (start_utc, stop_utc) = Self::fi_date_range_to_utc(start, stop, false);

        let is_transfer = self.selected_contract.as_ref()
            .and_then(|c| c["domain"].as_str())
            .map(|d| d == "electricity-transfer")
            .unwrap_or(false);

        let endpoint = if is_transfer {
            "/measurements/electricity-transfer"
        } else {
            "/measurements/electricity"
        };

        let url = format!("{}{}", HELEN_API_BASE, endpoint);
        tracing::info!("Fetching measurements from {}", url);

        let res = self.client.get(&url)
            .query(&[
                ("begin",            start_utc.to_rfc3339()),
                ("end",              stop_utc.to_rfc3339()),
                ("resolution",       resolution.as_str().to_string()),
                ("delivery_site_id", delivery_site_id),
                ("allow_transfer",   "true".to_string()),
            ])
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send().await?;

        let status = res.status();
        let body   = res.text().await?;
        if !status.is_success() {
            return Err(anyhow!("Measurements fetch failed ({}): {}", status, body));
        }

        serde_json::from_str(&body)
            .with_context(|| format!("Failed to decode measurements JSON: {}", body))
    }

    // -----------------------------------------------------------------------
    // Time helpers
    // -----------------------------------------------------------------------

    fn fi_date_range_to_utc(
        start:             NaiveDate,
        end:               NaiveDate,
        round_end_to_hour: bool,
    ) -> (DateTime<Utc>, DateTime<Utc>) {
        let local_start = Helsinki
            .from_local_datetime(&start.and_time(NaiveTime::MIN))
            .earliest()
            .expect("Invalid start datetime");

        let end_naive = end.and_hms_milli_opt(23, 59, 59, 999).unwrap();
        let local_end = Helsinki
            .from_local_datetime(&end_naive)
            .latest()
            .expect("Invalid end datetime");

        let utc_start: DateTime<Utc> = local_start.with_timezone(&Utc);
        let mut utc_end: DateTime<Utc> = local_end.with_timezone(&Utc);

        if round_end_to_hour {
            if utc_end.minute() > 0 || utc_end.second() > 0 || utc_end.nanosecond() > 0 {
                utc_end = (utc_end + Duration::hours(1))
                    .with_minute(0).unwrap()
                    .with_second(0).unwrap()
                    .with_nanosecond(0).unwrap();
            }
        }

        (utc_start, utc_end)
    }
}
