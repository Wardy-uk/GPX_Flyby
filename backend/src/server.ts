import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { nanoid } from "nanoid";
import {
  deleteTrackById,
  getTrackById,
  insertTrack,
  listTracks,
  type StoredTrackRow,
} from "./db.js";
import { parseGpx } from "./gpx.js";

type TrackPayload = {
  id: string;
  name: string;
  createdAt: string;
  sourceType: "upload" | "url";
  sourceValue: string;
  pointCount: number;
  distanceM: number;
  minEleM: number | null;
  maxEleM: number | null;
  bounds: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
  };
};

const toTrackPayload = (row: StoredTrackRow): TrackPayload => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  sourceType: row.source_type,
  sourceValue: row.source_value,
  pointCount: row.point_count,
  distanceM: row.distance_m,
  minEleM: row.min_ele_m,
  maxEleM: row.max_ele_m,
  bounds: JSON.parse(row.bounds_json),
});

const uploadsDir = resolve(process.cwd(), "data", "uploads");
const diagnosticsLogPath = resolve(process.cwd(), "data", "diagnostics.log");
mkdirSync(uploadsDir, { recursive: true });

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
});

app.get("/health", async () => ({ ok: true }));

app.post("/api/diagnostics", async (request, reply) => {
  const body = request.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    return reply.status(400).send({ error: "Invalid diagnostics payload" });
  }

  const row = {
    ts: new Date().toISOString(),
    ...body,
  };

  appendFileSync(diagnosticsLogPath, `${JSON.stringify(row)}\n`, "utf8");
  return { ok: true };
});

app.get("/api/tracks", async () => {
  const rows = listTracks.all() as StoredTrackRow[];
  return { tracks: rows.map(toTrackPayload) };
});

app.get("/api/tracks/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = getTrackById.get(id) as StoredTrackRow | undefined;

  if (!row) {
    return reply.status(404).send({ error: "Track not found" });
  }

  const xml = readFileSync(row.file_path, "utf8");
  const parsed = parseGpx(xml, row.name);

  return {
    track: toTrackPayload(row),
    points: parsed.points,
  };
});

app.delete("/api/tracks/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = getTrackById.get(id) as StoredTrackRow | undefined;

  if (!row) {
    return reply.status(404).send({ error: "Track not found" });
  }

  deleteTrackById.run(id);
  try {
    rmSync(row.file_path, { force: true });
  } catch {
    // Best-effort file cleanup; DB row is already removed.
  }

  return { ok: true, deletedId: id };
});

app.post("/api/tracks/upload", async (request, reply) => {
  const file = await request.file();

  if (!file) {
    return reply.status(400).send({ error: "No file uploaded" });
  }

  if (extname(file.filename).toLowerCase() !== ".gpx") {
    return reply.status(400).send({ error: "Only .gpx files are supported" });
  }

  const content = await file.toBuffer();
  const xml = content.toString("utf8");
  const parsed = parseGpx(xml, basename(file.filename, ".gpx"));

  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const filename = `${id}.gpx`;
  const filePath = resolve(uploadsDir, filename);

  writeFileSync(filePath, xml, "utf8");

  insertTrack.run({
    id,
    name: parsed.name,
    source_type: "upload",
    source_value: file.filename,
    file_path: filePath,
    created_at: createdAt,
    point_count: parsed.points.length,
    distance_m: parsed.distanceM,
    min_ele_m: parsed.minEleM,
    max_ele_m: parsed.maxEleM,
    bounds_json: JSON.stringify(parsed.bounds),
  });

  return reply.status(201).send({
    track: {
      id,
      name: parsed.name,
      createdAt,
      sourceType: "upload",
      sourceValue: file.filename,
      pointCount: parsed.points.length,
      distanceM: parsed.distanceM,
      minEleM: parsed.minEleM,
      maxEleM: parsed.maxEleM,
      bounds: parsed.bounds,
    },
  });
});

app.post("/api/tracks/import-url", async (request, reply) => {
  const body = request.body as { url?: string };
  const url = body?.url?.trim();

  if (!url) {
    return reply.status(400).send({ error: "url is required" });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return reply.status(400).send({ error: "Invalid URL" });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return reply.status(400).send({ error: "Only http/https URLs are supported" });
  }

  const response = await fetch(parsedUrl);
  if (!response.ok) {
    return reply
      .status(400)
      .send({ error: `Failed to fetch GPX URL: ${response.status} ${response.statusText}` });
  }

  const xml = await response.text();
  const fallbackName = basename(parsedUrl.pathname, ".gpx") || "Imported track";
  const parsed = parseGpx(xml, fallbackName);

  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const filename = `${id}.gpx`;
  const filePath = resolve(uploadsDir, filename);

  writeFileSync(filePath, xml, "utf8");

  insertTrack.run({
    id,
    name: parsed.name,
    source_type: "url",
    source_value: url,
    file_path: filePath,
    created_at: createdAt,
    point_count: parsed.points.length,
    distance_m: parsed.distanceM,
    min_ele_m: parsed.minEleM,
    max_ele_m: parsed.maxEleM,
    bounds_json: JSON.stringify(parsed.bounds),
  });

  return reply.status(201).send({
    track: {
      id,
      name: parsed.name,
      createdAt,
      sourceType: "url",
      sourceValue: url,
      pointCount: parsed.points.length,
      distanceM: parsed.distanceM,
      minEleM: parsed.minEleM,
      maxEleM: parsed.maxEleM,
      bounds: parsed.bounds,
    },
  });
});

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "8787");

app.listen({ host, port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
