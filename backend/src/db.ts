import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = resolve(process.cwd(), "data", "tracks.db");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_value TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    point_count INTEGER NOT NULL,
    distance_m REAL NOT NULL,
    min_ele_m REAL,
    max_ele_m REAL,
    bounds_json TEXT NOT NULL
  );
`);

export type StoredTrackRow = {
  id: string;
  name: string;
  source_type: "upload" | "url";
  source_value: string;
  file_path: string;
  created_at: string;
  point_count: number;
  distance_m: number;
  min_ele_m: number | null;
  max_ele_m: number | null;
  bounds_json: string;
};

export const insertTrack = db.prepare(`
  INSERT INTO tracks (
    id, name, source_type, source_value, file_path, created_at,
    point_count, distance_m, min_ele_m, max_ele_m, bounds_json
  ) VALUES (
    @id, @name, @source_type, @source_value, @file_path, @created_at,
    @point_count, @distance_m, @min_ele_m, @max_ele_m, @bounds_json
  )
`);

export const listTracks = db.prepare(`
  SELECT * FROM tracks
  ORDER BY datetime(created_at) DESC
`);

export const getTrackById = db.prepare(`
  SELECT * FROM tracks WHERE id = ?
`);
