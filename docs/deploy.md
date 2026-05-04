# Aqua‑AI Free Deployment Plan (Render + Supabase + GitHub Actions)

## Overview

- Deploy backend and frontend on Render free tier
- Use Supabase Postgres (with PostGIS) as the managed database
- Schedule the data pipeline via GitHub Actions
- Optional cache: Upstash Redis (free tier)

## Prerequisites

- GitHub repository access for this project
- Render account
- Supabase account
- Secrets prepared:
  - DATABASE_URL (from Supabase)
  - JWT_SECRET (any long random string)
  - Optional API keys for data pipeline (DATA_GOV_IN_API_KEY, WEATHER_API_KEY)

## Step 1: Create the Database (Supabase)

- ✅ Supabase project created: **<your-project-name>**
- ✅ PostGIS extension enabled
- ✅ All database tables, views, functions, and triggers created

### Supabase Project Details

| Property      | Value                                 |
| ------------- | ------------------------------------- |
| Project Name  | <your-project-name>                   |
| Project ID    | `<your-project-id>`                   |
| Project URL   | https://<your-project-id>.supabase.co |
| Database Host | `db.<your-project-id>.supabase.co`    |
| Region        | <your-region>                         |
| Status        | **<expected-status>**                 |

### Connection String Format

```
postgresql://postgres:[YOUR-PASSWORD]@db.<your-project-id>.supabase.co:5432/postgres
```

> ⚠️ **Important**: Get your database password from the Supabase Dashboard:
> Settings → Database → Connection String → URI

### Applied Migrations

11 migrations have been applied:

1. enable_postgis_extension
2. create_custom_types
3. create_locations_table
4. create_water_quality_parameters_table
5. create_water_quality_readings_table
6. create_ai_predictions_table
7. create_alerts_table
8. create_weather_and_community_tables
9. create_data_sources_and_wqi_tables
10. create_views
11. create_functions_and_triggers

## Step 2: Prepare Environment Variables

- Backend (Render):
  - DATABASE_URL: Supabase direct Postgres URL
  - JWT_SECRET: long random string
  - NODE_ENV: production
  - PORT: 10000
  - Optional (for Supabase REST access or custom domains):
    - SUPABASE_URL
    - SUPABASE_SERVICE_KEY (preferred) or SUPABASE_ANON_KEY
- Frontend (Render):
  - REACT_APP_API_URL is auto-populated from backend via the blueprint

## Step 3: Deploy on Render via Blueprint

- In Render Dashboard: New → Blueprint → Connect repository
- Render reads `render.yaml` and proposes two services:
  - Web service: aqua-ai-backend (root: backend)
  - Static site: aqua-ai-frontend (root: frontend)
- Set environment variables on aqua-ai-backend:
  - DATABASE_URL, JWT_SECRET, NODE_ENV=production, PORT=10000
- Confirm the start command runs migrations:
  - backend startCommand: `npm run migrate && npm start`
- Deploy; wait for build + health checks

## Step 4: Verify Services

- Backend:
  - Visit the backend URL shown by Render
  - Check `GET /api/health`
- Frontend:
  - Visit the static site URL
  - Open DevTools → Network and confirm API calls point to backend

## Step 5: Trigger Data Pipeline (Manual or Startup)

- Add repository secrets:
  - SUPABASE_DATABASE_URL: your Supabase connection string
  - DATA_GOV_IN_API_KEY, WEATHER_API_KEY (optional)
- Create `.github/workflows/data-pipeline.yml` with manual dispatch:

```yaml
name: Data Pipeline Sync
on:
  workflow_dispatch:
jobs:
  run-pipeline:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install deps
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r data-pipeline/requirements.txt
      - name: Run pipeline
        env:
          DATABASE_URL: ${{ secrets.SUPABASE_DATABASE_URL }}
          DATA_GOV_IN_API_KEY: ${{ secrets.DATA_GOV_IN_API_KEY }}
          WEATHER_API_KEY: ${{ secrets.WEATHER_API_KEY }}
        run: python data-pipeline/fetch_data.py
```

- Optional: run the pipeline on backend startup by setting `DATA_PIPELINE_ON_START=true`
  (requires Python + dependencies available in your runtime).
- Monitor Action runs and Supabase table updates

## Step 6: Security & Reliability

- Keep JWT_SECRET and DATABASE_URL only in Render and GitHub Secrets
- Avoid committing secrets to the repo
- Enable Postgres row-level security only if required by your access pattern
- Expect occasional cold starts on free tiers; use pooled connections if needed

## Step 7: Custom Domain (Optional)

- In Render: add a custom domain to aqua-ai-frontend
- The blueprint links services via `fromService`, so `FRONTEND_URL` and `REACT_APP_API_URL` stay in sync
- Configure DNS at your registrar (Render provides records)

## Step 8: Optional Cache (Upstash Redis)

- Create a free Upstash Redis database
- Add `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` to backend env vars
- Use Redis for caching hot endpoints or session data

## Step 9: Rollbacks and Updates

- Render keeps build history; redeploy previous build if needed
- Migrations:
  - Use Knex migrations to roll forward/backward
  - Consider a safe migration process: apply changes, validate, then expose new endpoints

## Step 10: Monitoring

- Render: build logs, runtime logs, health checks
- Supabase: query analyzer, connection stats, pg logs
- GitHub Actions: run history and failures

## Notes

- Free tiers can apply rate limits and sleep; this setup is designed to minimize operational effort while staying within free allowances
- If you need guaranteed uptime or heavier workloads, upgrade Render plans or move to a VPS and use `docker-compose`
