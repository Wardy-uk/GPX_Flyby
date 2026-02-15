import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike, Map, StyleSpecification } from "maplibre-gl";
import {
  getTrackDetails,
  importTrackByUrl,
  listTracks,
  type TrackDetails,
  type TrackSummary,
  uploadTrack,
} from "./api";

type PlaybackState = "idle" | "playing" | "paused";
type CameraPresetId = "cinematic" | "balanced" | "chase";

type CameraPreset = {
  id: CameraPresetId;
  label: string;
  lookaheadPoints: number;
  chasePoints: number;
  pitch: number;
  zoomBase: number;
  zoomDistanceDivisor: number;
  zoomMin: number;
  zoomMax: number;
  bearingSmoothing: number;
};

const terrainStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
      maxzoom: 19,
    },
    terrainSource: {
      type: "raster-dem",
      tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 13,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
  terrain: {
    source: "terrainSource",
    exaggeration: 1.3,
  },
};

const sourceId = "track-source";
const layerId = "track-line";
const cameraPresets: CameraPreset[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    lookaheadPoints: 16,
    chasePoints: 12,
    pitch: 72,
    zoomBase: 13.2,
    zoomDistanceDivisor: 24_000,
    zoomMin: 10.4,
    zoomMax: 13.8,
    bearingSmoothing: 0.16,
  },
  {
    id: "balanced",
    label: "Balanced",
    lookaheadPoints: 10,
    chasePoints: 8,
    pitch: 74,
    zoomBase: 13.7,
    zoomDistanceDivisor: 32_000,
    zoomMin: 11,
    zoomMax: 14.4,
    bearingSmoothing: 0.24,
  },
  {
    id: "chase",
    label: "Chase",
    lookaheadPoints: 7,
    chasePoints: 5,
    pitch: 78,
    zoomBase: 14.4,
    zoomDistanceDivisor: 45_000,
    zoomMin: 11.8,
    zoomMax: 15.2,
    bearingSmoothing: 0.34,
  },
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lambda1 = toRad(lon1);
  const lambda2 = toRad(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};
const shortestAngleDiff = (from: number, to: number) => {
  const diff = ((to - from + 540) % 360) - 180;
  return diff;
};

const formatDistanceKm = (m: number) => `${(m / 1000).toFixed(1)} km`;

const App = () => {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameMsRef = useRef<number | null>(null);
  const lastUiFrameMsRef = useRef<number | null>(null);
  const lastBearingRef = useRef<number | null>(null);
  const progressRef = useRef<number>(0);

  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<TrackDetails | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [importUrl, setImportUrl] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [cameraPresetId, setCameraPresetId] = useState<CameraPresetId>("balanced");

  const cameraPreset = useMemo(
    () => cameraPresets.find((preset) => preset.id === cameraPresetId) ?? cameraPresets[1],
    [cameraPresetId],
  );

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedTrackId) ?? null,
    [tracks, selectedTrackId],
  );

  const loadTracks = async () => {
    const result = await listTracks();
    setTracks(result);

    if (!selectedTrackId && result.length > 0) {
      setSelectedTrackId(result[0].id);
    }
  };

  useEffect(() => {
    void loadTracks().catch((err: unknown) => {
      setStatus(err instanceof Error ? err.message : "Failed to load tracks");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapElRef.current,
      style: terrainStyle,
      center: [-2.6, 54.4],
      zoom: 5.5,
      pitch: 60,
      bearing: -20,
      maxPitch: 85,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [],
          },
        },
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#00d2ff",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedTrackId) {
      setSelectedDetails(null);
      return;
    }

    setStatus("Loading selected track...");
    setPlaybackState("idle");
    setProgress(0);
    progressRef.current = 0;
    lastBearingRef.current = null;

    void getTrackDetails(selectedTrackId)
      .then((details) => {
        setSelectedDetails(details);
        setStatus(`Loaded ${details.track.name}`);
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : "Failed to load track details");
      });
  }, [selectedTrackId]);

  useEffect(() => {
    const map = mapRef.current;
    const details = selectedDetails;
    if (!map || !details || !mapReady || !map.getSource(sourceId)) return;

    const coords = details.points.map((p) => [p.lon, p.lat]);
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    source.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    });

    const b = details.track.bounds;
    const bounds: LngLatBoundsLike = [
      [b.minLon, b.minLat],
      [b.maxLon, b.maxLat],
    ];

    map.fitBounds(bounds, {
      padding: 80,
      maxZoom: 14,
      duration: 1200,
      pitch: 55,
    });
  }, [selectedDetails, mapReady]);

  const updateCameraAtProgress = (value: number) => {
    const details = selectedDetails;
    const map = mapRef.current;
    if (!details || !map || details.points.length < 2) return;

    const maxIndex = details.points.length - 1;
    const scaled = clamp(value, 0, 1) * maxIndex;
    const index = Math.floor(scaled);
    const t = scaled - index;

    const a = details.points[index];
    const b = details.points[Math.min(index + 1, maxIndex)];

    const lookahead = details.points[Math.min(index + cameraPreset.lookaheadPoints, maxIndex)];
    const behind = details.points[Math.max(index - cameraPreset.chasePoints, 0)];

    const lookLon = lerp(a.lon, lookahead.lon, t);
    const lookLat = lerp(a.lat, lookahead.lat, t);
    const camLon = lerp(behind.lon, a.lon, t);
    const camLat = lerp(behind.lat, a.lat, t);

    const rawBearing = bearingDeg(camLat, camLon, lookLat, lookLon);
    const prevBearing = lastBearingRef.current;
    const smoothedBearing =
      prevBearing === null
        ? rawBearing
        : (prevBearing +
            shortestAngleDiff(prevBearing, rawBearing) * cameraPreset.bearingSmoothing +
            360) %
          360;
    lastBearingRef.current = smoothedBearing;

    const zoom = clamp(
      cameraPreset.zoomBase - details.track.distanceM / cameraPreset.zoomDistanceDivisor,
      cameraPreset.zoomMin,
      cameraPreset.zoomMax,
    );

    map.jumpTo({
      center: [camLon, camLat],
      bearing: smoothedBearing,
      pitch: cameraPreset.pitch,
      zoom,
    });
  };

  useEffect(() => {
    if (playbackState !== "playing") {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameMsRef.current = null;
      lastUiFrameMsRef.current = null;
      return;
    }

    const details = selectedDetails;
    if (!details) return;

    const baseDurationMs = clamp(details.track.distanceM * 6, 25_000, 150_000);

    const tick = (timestamp: number) => {
      if (lastFrameMsRef.current === null) {
        lastFrameMsRef.current = timestamp;
      }

      const delta = timestamp - lastFrameMsRef.current;
      lastFrameMsRef.current = timestamp;

      const increment = delta / (baseDurationMs / speed);
      const next = clamp(progressRef.current + increment, 0, 1);
      progressRef.current = next;
      updateCameraAtProgress(next);

      const lastUiFrame = lastUiFrameMsRef.current;
      if (lastUiFrame === null || timestamp - lastUiFrame > 80 || next >= 1) {
        lastUiFrameMsRef.current = timestamp;
        setProgress(next);
      }

      if (next >= 1) {
        setPlaybackState("paused");
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameMsRef.current = null;
      lastUiFrameMsRef.current = null;
    };
  }, [playbackState, selectedDetails, speed, cameraPreset]);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("Uploading GPX...");
    try {
      const track = await uploadTrack(file);
      setTracks((prev) => [track, ...prev]);
      setSelectedTrackId(track.id);
      setStatus(`Uploaded ${track.name}`);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      event.target.value = "";
    }
  };

  const onImportUrl = async () => {
    if (!importUrl.trim()) return;

    setStatus("Importing GPX from URL...");
    try {
      const track = await importTrackByUrl(importUrl.trim());
      setTracks((prev) => [track, ...prev]);
      setSelectedTrackId(track.id);
      setImportUrl("");
      setStatus(`Imported ${track.name}`);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "URL import failed");
    }
  };

  const togglePlay = () => {
    if (!selectedDetails) return;

    if (playbackState === "playing") {
      setPlaybackState("paused");
      return;
    }

    if (progress >= 1) {
      setProgress(0);
      progressRef.current = 0;
      lastBearingRef.current = null;
      updateCameraAtProgress(0);
    }

    if (progress < 1) {
      progressRef.current = progress;
    }

    setPlaybackState("playing");
  };

  const onScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value) / 100;
    setProgress(next);
    progressRef.current = next;
    updateCameraAtProgress(next);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>GPX Terrain Flyby</h1>

        <section className="panel">
          <h2>Import GPX</h2>
          <input className="input" type="file" accept=".gpx" onChange={onUpload} />
          <input
            className="input"
            type="url"
            placeholder="https://example.com/track.gpx"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
          />
          <button className="button primary" onClick={() => void onImportUrl()}>
            Import From URL
          </button>
          <p className="status">{status}</p>
        </section>

        <section className="panel">
          <h2>Saved Tracks</h2>
          <div className="track-list">
            {tracks.length === 0 && <p className="track-meta">No tracks loaded yet.</p>}
            {tracks.map((track) => (
              <button
                key={track.id}
                className={`track-item ${track.id === selectedTrack?.id ? "active" : ""}`}
                onClick={() => setSelectedTrackId(track.id)}
              >
                <p className="track-title">{track.name}</p>
                <p className="track-meta">
                  {formatDistanceKm(track.distanceM)} | {track.pointCount} pts
                </p>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="map-wrap">
        <div ref={mapElRef} className="map" />

        <div className="controls">
          <button className="button primary" onClick={togglePlay} disabled={!selectedDetails}>
            {playbackState === "playing" ? "Pause" : "Play"}
          </button>
          <input className="range" type="range" min={0} max={100} value={Math.round(progress * 100)} onChange={onScrub} />
          <select
            className="select"
            value={String(speed)}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
          <select
            className="select"
            value={cameraPresetId}
            onChange={(e) => {
              lastBearingRef.current = null;
              setCameraPresetId(e.target.value as CameraPresetId);
            }}
          >
            {cameraPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </main>
    </div>
  );
};

export default App;
