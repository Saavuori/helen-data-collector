# HelenFlow — Helen Electricity Data Collector

A self-hosted tool that collects your electricity consumption and spot price data from [Helen.fi](https://helen.fi) and displays it in a clean web dashboard. Optionally exports data to InfluxDB.

![Dashboard showing electricity usage and spot price chart](https://github.com/Saavuori/helen-data-collector/raw/main/docs/screenshot.png)

---

## Features

- 📊 **Interactive dashboard** — hourly and 15-minute consumption charts with spot prices
- 🔄 **Automatic session refresh** — re-authenticates with Helen every 20 minutes
- 📡 **InfluxDB export** — optional background sync of consumption data
- 🐳 **Single Docker container** — backend + frontend served on one port
- 🔁 **Auto-updates** — Watchtower pulls new images automatically

---

## Quick Install (Raspberry Pi or any Linux)

### Prerequisites

- Docker + Docker Compose installed  
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

### 1. Run the installer

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Saavuori/helen-data-collector/main/install.sh)
```

This creates a `helen-collector/` directory with everything you need.

### 2. Start the app

```bash
cd helen-collector
docker compose up -d
```

### 3. Open the web UI

```
http://<your-device-ip>:3000
```

Log in with your **Helen.fi** email and password. Your credentials are saved locally so the app logs in automatically on restart.

---

## Running Alongside RuuviGateway

HelenFlow and RuuviGateway use **separate Watchtower scopes** so they update independently without interfering with each other. Just run them in their own directories:

```
~/ruuvigateway/       ← existing RuuviGateway setup
~/helen-collector/    ← HelenFlow
```

---

## InfluxDB Export (Optional)

Open **Settings** (gear icon) in the UI and fill in your InfluxDB connection details. The app will sync yesterday's and today's consumption data on the configured interval.

Data is written using this schema:

```
helen_electricity,gsrn=<meter-id>
  electricity=<kWh>
  spot_price=<c/kWh excl. VAT>
  spot_price_vat=<c/kWh incl. VAT>
  <unix timestamp in seconds>
```

---

## Updating

Updates are automatic — [Watchtower](https://containrrr.dev/watchtower/) checks for new images every 5 minutes and restarts the container when one is available.

To update manually:

```bash
cd helen-collector
docker compose pull
docker compose up -d
```

---

## Data Persistence

| File | Contents |
|---|---|
| `credentials.json` | Your Helen.fi login (saved by the app on first login) |
| `influx_config.json` | InfluxDB connection settings |

Both files are mounted into the container as volumes and survive container restarts and updates.

---

## Local Development

**Backend (Rust/Axum):**
```bash
cd backend
cargo run
# Serves API on http://localhost:3000
```

**Frontend (React/Vite):**
```bash
cd frontend
npm install
npm run dev
# Serves UI on http://localhost:5173 (proxies API to :3000)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Rust, Axum, reqwest, tokio |
| Frontend | React 19, TypeScript, Vite, Fluent UI v9, Recharts |
| Container | Docker, Alpine Linux |
| CI/CD | GitHub Actions, GHCR |
| Auto-update | Watchtower |
