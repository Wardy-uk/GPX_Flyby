export type Bounds = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export type TrackSummary = {
  id: string;
  name: string;
  createdAt: string;
  sourceType: "upload" | "url";
  sourceValue: string;
  pointCount: number;
  distanceM: number;
  minEleM: number | null;
  maxEleM: number | null;
  bounds: Bounds;
};

export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time: string | null;
  distanceFromStartM: number;
};

export type TrackDetails = {
  track: TrackSummary;
  points: TrackPoint[];
};

export type DiagnosticsPayload = {
  event: string;
  details?: Record<string, unknown>;
};

const apiBase =
  import.meta.env.VITE_API_BASE && String(import.meta.env.VITE_API_BASE).trim().length > 0
    ? String(import.meta.env.VITE_API_BASE).trim()
    : "http://localhost:8787";

const jsonHeaders = {
  "Content-Type": "application/json",
};

const ensureOk = async (response: Response) => {
  if (response.ok) return;

  let message = `Request failed (${response.status})`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // ignore JSON parse failures
  }

  throw new Error(message);
};

export const listTracks = async (): Promise<TrackSummary[]> => {
  const response = await fetch(`${apiBase}/api/tracks`);
  await ensureOk(response);
  const data = (await response.json()) as { tracks: TrackSummary[] };
  return data.tracks;
};

export const uploadTrack = async (file: File): Promise<TrackSummary> => {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(`${apiBase}/api/tracks/upload`, {
    method: "POST",
    body: formData,
  });

  await ensureOk(response);
  const data = (await response.json()) as { track: TrackSummary };
  return data.track;
};

export const importTrackByUrl = async (url: string): Promise<TrackSummary> => {
  const response = await fetch(`${apiBase}/api/tracks/import-url`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ url }),
  });

  await ensureOk(response);
  const data = (await response.json()) as { track: TrackSummary };
  return data.track;
};

export const getTrackDetails = async (id: string): Promise<TrackDetails> => {
  const response = await fetch(`${apiBase}/api/tracks/${id}`);
  await ensureOk(response);
  return (await response.json()) as TrackDetails;
};

export const deleteTrack = async (id: string): Promise<void> => {
  const response = await fetch(`${apiBase}/api/tracks/${id}`, {
    method: "DELETE",
  });
  await ensureOk(response);
};

export const postDiagnostics = async (payload: DiagnosticsPayload): Promise<void> => {
  await fetch(`${apiBase}/api/diagnostics`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
};
