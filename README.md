# GPX Terrain Flyby (Windows -> Raspberry Pi ready)

Split app MVP:
- `backend`: Fastify API + GPX parser + SQLite storage
- `frontend`: React + Vite + MapLibre terrain flyby viewer

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Run both services:

```bash
npm run dev
```

3. Open frontend:
- `http://localhost:5173`

Backend runs on:
- `http://localhost:8787`

## What v1 includes

- Upload `.gpx` files
- Import GPX via URL
- Store tracks in `backend/data/tracks.db` and `backend/data/uploads/*.gpx`
- Terrain map with OpenStreetMap + free DEM tiles
- Auto flyby camera
- Playback controls: play/pause, scrub, speed

## API

- `GET /health`
- `GET /api/tracks`
- `GET /api/tracks/:id`
- `POST /api/tracks/upload` (multipart, `file`)
- `POST /api/tracks/import-url` (`{ "url": "https://..." }`)

## Notes

- No authentication in v1 (private/local usage)
- GPX only in v1
- UK/global tracks supported by current map/elevation sources
