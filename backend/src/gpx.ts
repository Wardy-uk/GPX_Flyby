import { XMLParser } from "fast-xml-parser";

export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time: string | null;
  distanceFromStartM: number;
};

export type ParsedGpx = {
  name: string;
  points: TrackPoint[];
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

const toArray = <T>(v: T | T[] | undefined): T[] => {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
};

const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const haversineMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const parseGpx = (xml: string, fallbackName: string): ParsedGpx => {
  const parsed = parser.parse(xml) as {
    gpx?: {
      metadata?: { name?: string };
      trk?: Array<{ name?: string; trkseg?: Array<{ trkpt?: Array<Record<string, string>> }> }>;
      rte?: { rtept?: Array<Record<string, string>> };
    };
  };

  const gpx = parsed.gpx;
  if (!gpx) {
    throw new Error("Invalid GPX: missing <gpx> root element.");
  }

  const tracks = toArray(gpx.trk);
  const trackPointsRaw = tracks
    .flatMap((trk) => toArray(trk.trkseg))
    .flatMap((seg) => toArray(seg.trkpt));

  const routePointsRaw = toArray(gpx.rte?.rtept);
  const rawPoints = trackPointsRaw.length > 0 ? trackPointsRaw : routePointsRaw;

  if (rawPoints.length < 2) {
    throw new Error("GPX must contain at least 2 points.");
  }

  let distanceM = 0;
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minEleM = Number.POSITIVE_INFINITY;
  let maxEleM = Number.NEGATIVE_INFINITY;

  const points: TrackPoint[] = [];

  for (const raw of rawPoints) {
    const lat = toFiniteNumber(raw.lat);
    const lon = toFiniteNumber(raw.lon);
    if (lat === null || lon === null) continue;

    const eleValue = toFiniteNumber(raw.ele);
    const point: TrackPoint = {
      lat,
      lon,
      ele: eleValue,
      time: typeof raw.time === "string" ? raw.time : null,
      distanceFromStartM: distanceM,
    };

    if (points.length > 0) {
      const prev = points[points.length - 1];
      distanceM += haversineMeters(prev.lat, prev.lon, lat, lon);
      point.distanceFromStartM = distanceM;
    }

    minLat = Math.min(minLat, lat);
    minLon = Math.min(minLon, lon);
    maxLat = Math.max(maxLat, lat);
    maxLon = Math.max(maxLon, lon);

    if (eleValue !== null) {
      minEleM = Math.min(minEleM, eleValue);
      maxEleM = Math.max(maxEleM, eleValue);
    }

    points.push(point);
  }

  if (points.length < 2) {
    throw new Error("GPX must contain at least 2 valid latitude/longitude points.");
  }

  const trackName =
    tracks.find((t) => t.name && t.name.trim().length > 0)?.name?.trim() ||
    gpx.metadata?.name?.trim() ||
    fallbackName;

  return {
    name: trackName,
    points,
    distanceM,
    minEleM: Number.isFinite(minEleM) ? minEleM : null,
    maxEleM: Number.isFinite(maxEleM) ? maxEleM : null,
    bounds: { minLat, minLon, maxLat, maxLon },
  };
};
