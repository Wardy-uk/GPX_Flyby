# FAQ - GPX Flyby

## What is this project?
This is the standalone GPX flyby application, split into:
- `backend` (Fastify + SQLite + GPX parser)
- `frontend` (React + Vite + MapLibre)

## How do I run it locally?
1. `npm install`
2. `npm run dev`
3. Frontend: `http://localhost:5173`
4. Backend: `http://localhost:8787`

## How do I build it?
- Root: `npm run build`
- Backend only: `npm run build -w backend`
- Frontend only: `npm run build -w frontend`

## Key dependencies
Root:
- `concurrently`

Backend:
- `fastify`
- `@fastify/cors`
- `@fastify/multipart`
- `better-sqlite3`
- `fast-xml-parser`
- `nanoid`

Frontend:
- `react`
- `react-dom`
- `maplibre-gl`
- `vite`

## Environment setup
Frontend example vars are in `frontend/.env.example`:
- `VITE_API_BASE=http://localhost:8787`
- `VITE_OS_API_KEY=`
- `VITE_OS_RASTER_LAYER=Outdoor_3857`

## Useful paths
- `backend/src/server.ts`
- `backend/src/db.ts`
- `frontend/src/App.tsx`
- `frontend/src/flybyCore.ts`
- `scripts/sync-flyby-core.ps1`

## How do I resume Codex in this repo?
From this folder, run:
- `codex resume`
Then select the latest session for this repo.

## Cross-repo sync (important)
This repo is the source of flyby core logic for the website.
Sync script:
- `powershell -ExecutionPolicy Bypass -File "C:\Git\gpx flyby\scripts\sync-flyby-core.ps1"`

This copies:
- `C:\Git\gpx flyby\frontend\src\flybyCore.ts`
into:
- `C:\Git\websites\Walking With Ember\src\lib\flybyCore.ts`

## Future TODO
1. Add auth before exposing backend outside private/local environments.
2. Add tests for GPX parsing and interpolation edge cases.
3. Add API rate limits and upload size safeguards.
4. Add CI checks for backend build + frontend build.
5. Document release/deploy process for Raspberry Pi target.

## Data/storage notes
- Uploaded GPX files and SQLite DB are local runtime data.
- Ensure data files are backed up if you need persistence.
