# Helen API Integration — Backend Documentation

> How the Rust backend authenticates with Helen.fi and fetches electricity consumption data.

---

## Overview

Helen (helen.fi) does not publish a public API. The backend reverse-engineers the OAuth2/SSO login flow used by the **OmaHelen** web portal and then calls Helen's internal REST API endpoints to retrieve metered electricity data.

The two base URLs used are:

| Purpose | Base URL |
|---|---|
| Data API | `https://api.omahelen.fi/v25` |
| OAuth2 login | `https://login.helen.fi` |
| Portal login entry | `https://www.helen.fi/hcc/TupasLoginFrame?service=account&locale=fi` |

---

## Authentication Flow

Helen uses a multi-step web SSO flow (not standard OAuth2 PKCE — it involves form POSTs and HTML scraping). The Rust client mimics a browser by:

1. Disabling automatic redirects (`redirect::Policy::none`)
2. Carrying a persistent cookie jar (`reqwest::cookie::Jar`)
3. Following `Location` headers manually, switching to GET after every redirect (matching Python `requests` library behaviour)

### Steps

```
Browser                     helen.fi servers
   |                              |
   |-- GET TupasLoginFrame ------>|   Get form action URL + method
   |<-- HTML form ----------------| 
   |                              |
   |-- GET/POST auth_url -------->|   Hit the authorization endpoint
   |<-- HTML (login page) --------|
   |                              |
   |-- POST credentials ----------|   username + password in form body
   |<-- HTML (code + state) ------|
   |                              |
   |-- GET continue_url ----------|   ?code=...&state=...
   |   (Step A)                   |
   |<-- HTML (<a href=...>) ------|
   |                              |
   |-- GET fixed_link ----------->|   fix URL: omahelen→oma.helen, /vNN/→/v21/
   |   (Step B)                   |
   |<-- HTML (code + state) ------|
   |                              |
   |-- GET final_url ------------>|   ?code=...&state=...
   |   (Step C)                   |
   |<-- Set-Cookie: access-token  |   Token lands in cookie jar
```

After a successful login the `access-token` cookie is found on the domain `https://oma.helen.fi`. The client searches these domains in order:

```
https://api.omahelen.fi
https://oma.helen.fi
https://www.helen.fi
https://login.helen.fi
```

The token is a **Bearer token** sent in the `Authorization` header on every subsequent API call.

### URL Fixup

During Step B, Helen returns a URL that uses the old domain `omahelen` and an incorrect API version. The client fixes it before following:

```
/vNN/   →   /v21/
omahelen  →  oma.helen
```

---

## Contract Discovery (GSRN)

After login, the client calls the **contract list** endpoint to find the active electricity metering point (identified by a GSRN number).

```
GET https://api.omahelen.fi/v25/contract/list
    ?include_transfer=true
    &update=true
    &include_products=true
Authorization: Bearer <token>
```

### Response structure (simplified)

```json
{
  "contracts": [
    {
      "gsrn": "643006971026162450",
      "domain": "electricity",
      "start_date": "2023-01-01T00:00:00",
      "end_date": "9999-12-31T00:00:00",
      "delivery_site": { "id": 12345 }
    }
  ]
}
```

### Contract selection logic

1. Filter out contracts where `start_date` is in the future or `end_date` is in the past.
2. Exclude `domain == "electricity-production"` (solar feed-in).
3. Pick the most recently started contract (highest `start_date`).

The selected contract's `gsrn` is cached in memory and used in every data request.

---

## Consumption Data Endpoint

This is Helen's internal "chart data" API. It returns time-series electricity consumption.

```
GET https://api.omahelen.fi/v25/chart-data/{gsrn}/electricity
    ?start=<RFC3339>
    &stop=<RFC3339>
    &resolution=<quarter|hour|day|month>
    &channel=oh
Authorization: Bearer <token>
```

### Parameters

| Parameter | Description | Example |
|---|---|---|
| `start` | Start of time range (UTC, RFC3339) | `2026-03-22T22:00:00+00:00` |
| `stop` | End of time range (UTC, RFC3339) | `2026-03-23T20:59:59+00:00` |
| `resolution` | Granularity of data points | `quarter` (15 min), `hour`, `day`, `month` |
| `channel` | Data channel — always `oh` | `oh` |

### Response structure

```json
{
  "series": [
    {
      "start": "2026-03-21T22:00:00Z",
      "stop":  "2026-03-21T22:15:00Z",
      "electricity": 0.046,
      "electricity_spot_prices": 1.349,
      "electricity_spot_prices_vat": 1.692995
    },
    ...
  ]
}
```

> **Verified** against the live Helen API on 2026-03-23 using `test_raw_response.py`.

| Field | Type | Description |
|---|---|---|
| `start` | ISO 8601 (UTC) | Start of the measurement interval |
| `stop` | ISO 8601 (UTC) | End of the measurement interval |
| `electricity` | `number \| null` | Consumption in **kWh** for the interval |
| `electricity_spot_prices` | `number \| null` | Spot price **excluding VAT** in c/kWh |
| `electricity_spot_prices_vat` | `number \| null` | Spot price **including VAT** in c/kWh |

### Resolution options

| Value | Interval | Points per day |
|---|---|---|
| `quarter` | 15 minutes | 96 |
| `hour` | 1 hour | 24 |
| `day` | 1 day | 1 |
| `month` | 1 month | ~30 |

> The HelenFlow frontend always requests `quarter` resolution for maximum granularity.

---

## Time Zone Handling

Helen's meters are in **Helsinki time (Europe/Helsinki, UTC+2 / UTC+3 DST)**. The API however expects UTC timestamps.

The backend converts a local calendar date to a UTC range:

```
Local midnight (Helsinki)  →  UTC start
Local 23:59:59.999         →  UTC stop  (rounded up to next full hour)
```

For example, `2026-03-22` in Helsinki (UTC+2) becomes:

```
start: 2026-03-21T22:00:00Z
stop:  2026-03-22T21:59:59Z  →  rounded to  2026-03-22T22:00:00Z
```

---

## Credential Persistence

To avoid re-authenticating on every restart, the backend saves credentials to `credentials.json` in its working directory immediately after a successful login:

```json
{
  "username": "user@example.com",
  "password": "secret"
}
```

On startup, if this file exists, the backend performs an **automatic login** before the HTTP server starts listening. If auto-login fails (e.g. wrong password, network error), the backend starts normally and waits for a manual `/login` call from the frontend.

> **Security note:** Credentials are stored in plaintext. This is acceptable for a single-user local tool, but the file should not be committed to version control. It is already listed in `.gitignore`.

---

## Backend REST API (exposed to frontend)

The Rust backend (Axum) exposes these endpoints on port **3000**:

### `POST /login`

Authenticate with Helen.fi and persist credentials.

**Request body (JSON):**
```json
{ "username": "user@example.com", "password": "secret" }
```

**Responses:**
- `200 OK` — login succeeded
- `401 Unauthorized` — wrong credentials or login flow failed (body contains error string)

---

### `GET /status`

Check whether a valid session is active.

**Response (JSON):**
```json
{ "logged_in": true }
```

Used by the frontend on startup to decide whether to show the login form.

---

### `GET /consumption`

Fetch electricity consumption for a date range.

**Query parameters:**

| Parameter | Required | Description | Example |
|---|---|---|---|
| `start` | ✅ | Start date (YYYY-MM-DD) | `2026-03-22` |
| `stop` | ✅ | End date (YYYY-MM-DD, inclusive) | `2026-03-22` |
| `resolution` | ❌ | `quarter`, `hour`, `day`, `month` (default: `hour`) | `quarter` |

**Response (JSON):**
```json
{
  "series": [
    {
      "start": "2026-03-21T22:00:00Z",
      "stop":  "2026-03-21T22:15:00Z",
      "electricity": 0.046,
      "electricity_spot_prices": 1.349,
      "electricity_spot_prices_vat": 1.692995
    },
    {
      "start": "2026-03-21T22:15:00Z",
      "stop":  "2026-03-21T22:30:00Z",
      "electricity": 0.038,
      "electricity_spot_prices": 1.484,
      "electricity_spot_prices_vat": 1.86242
    }
  ]
}
```

**Responses:**
- `200 OK` — data returned
- `401 Unauthorized` — not logged in
- `500 Internal Server Error` — Helen API call failed (body contains error string)

---

## Key Files

| File | Purpose |
|---|---|
| `backend/src/helen_client.rs` | All Helen API logic: login flow, contract discovery, data fetching |
| `backend/src/main.rs` | Axum HTTP server, route handlers, startup auto-login |
| `backend/credentials.json` | Saved credentials (gitignored) |
