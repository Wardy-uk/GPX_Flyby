import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike, Map, StyleSpecification } from "maplibre-gl";
import {
  deleteTrack,
  getTrackDetails,
  importTrackByUrl,
  listTracks,
  postDiagnostics,
  type TrackDetails,
  type TrackSummary,
  uploadTrack,
} from "./api";

type PlaybackState = "idle" | "playing" | "paused";
type CameraPresetId = "cinematic" | "balanced" | "chase";
type OsRasterLayerId = "Outdoor_3857" | "Road_3857" | "Light_3857";

type CameraPreset = {
  id: CameraPresetId;
  label: string;
  lookaheadMeters: number;
  chaseMeters: number;
  pitch: number;
  zoomBase: number;
  zoomMin: number;
  zoomMax: number;
  bearingSmoothing: number;
};
type CameraState = {
  lon: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
};
type DiagnosticsState = {
  selectedTrackId: string | null;
  selectedPointCount: number;
  selectedDistanceM: number;
  routeCoordCount: number;
  mapLoaded: boolean;
  styleLoaded: boolean;
  sourcePresent: boolean;
  layerPresent: boolean;
  sourceCoordCount: number;
  renderedFeatureCount: number;
  cameraCenter: string;
  cameraZoom: number;
  cameraBearing: number;
  cameraPitch: number;
  viewBounds: string;
  routeBounds: string;
  progress: number;
  playbackState: PlaybackState;
  status: string;
};

const sourceId = "track-source";
const layerCasingId = "track-line-casing";
const layerId = "track-line";
const terrainSourceId = "terrain-source";
const osLayerOptions: Array<{ id: OsRasterLayerId; label: string }> = [
  { id: "Outdoor_3857", label: "OS Outdoor" },
  { id: "Road_3857", label: "OS Road" },
  { id: "Light_3857", label: "OS Light" },
];
const isOsRasterLayerId = (value: string): value is OsRasterLayerId =>
  osLayerOptions.some((option) => option.id === value);

const osApiKey =
  import.meta.env.VITE_OS_API_KEY && String(import.meta.env.VITE_OS_API_KEY).trim().length > 0
    ? String(import.meta.env.VITE_OS_API_KEY).trim()
    : "";
const configuredOsRasterLayer =
  import.meta.env.VITE_OS_RASTER_LAYER && String(import.meta.env.VITE_OS_RASTER_LAYER).trim().length > 0
    ? String(import.meta.env.VITE_OS_RASTER_LAYER).trim()
    : "Outdoor_3857";
const buildTerrainStyle = (osRasterLayer: OsRasterLayerId): StyleSpecification => {
  const baseTiles = osApiKey
    ? [`https://api.os.uk/maps/raster/v1/zxy/${osRasterLayer}/{z}/{x}/{y}.png?key=${encodeURIComponent(osApiKey)}`]
    : ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
  const baseAttribution = osApiKey
    ? "&copy; Crown copyright and database rights 2026 Ordnance Survey"
    : "&copy; OpenStreetMap contributors";

  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: baseTiles,
        tileSize: 256,
        attribution: baseAttribution,
        maxzoom: 19,
      },
      [terrainSourceId]: {
        type: "raster-dem",
        tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: 13,
      },
      [sourceId]: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      },
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
      },
      {
        id: "terrain-hillshade",
        type: "hillshade",
        source: terrainSourceId,
        paint: {
          "hillshade-shadow-color": "#253347",
          "hillshade-highlight-color": "#93a7c1",
          "hillshade-exaggeration": 0.55,
        },
      },
      {
        id: layerCasingId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#111111",
          "line-width": 10,
          "line-opacity": 0,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      },
      {
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ff4d4d",
          "line-width": 6.5,
          "line-opacity": 0,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      },
    ],
    terrain: {
      source: terrainSourceId,
      exaggeration: 1.25,
    },
  };
};

const cameraPresets: CameraPreset[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    lookaheadMeters: 320,
    chaseMeters: 135,
    pitch: 72,
    zoomBase: 13.6,
    zoomMin: 11.5,
    zoomMax: 14.2,
    bearingSmoothing: 0.14,
  },
  {
    id: "balanced",
    label: "Balanced",
    lookaheadMeters: 250,
    chaseMeters: 105,
    pitch: 68,
    zoomBase: 13.8,
    zoomMin: 11.6,
    zoomMax: 14.3,
    bearingSmoothing: 0.16,
  },
  {
    id: "chase",
    label: "Chase",
    lookaheadMeters: 180,
    chaseMeters: 80,
    pitch: 62,
    zoomBase: 14.1,
    zoomMin: 11.8,
    zoomMax: 14.5,
    bearingSmoothing: 0.2,
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
const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const interpolatePointAtDistance = (
  points: TrackDetails["points"],
  targetDistanceM: number,
): { lat: number; lon: number; index: number } => {
  if (points.length === 0) return { lat: 0, lon: 0, index: 0 };
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon, index: 0 };

  const maxDistance = points[points.length - 1].distanceFromStartM;
  const target = clamp(targetDistanceM, 0, Math.max(maxDistance, 0));

  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].distanceFromStartM < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const rightIndex = clamp(low, 1, points.length - 1);
  const leftIndex = rightIndex - 1;
  const left = points[leftIndex];
  const right = points[rightIndex];
  const span = Math.max(right.distanceFromStartM - left.distanceFromStartM, 0.0001);
  const t = clamp((target - left.distanceFromStartM) / span, 0, 1);

  return {
    lat: lerp(left.lat, right.lat, t),
    lon: lerp(left.lon, right.lon, t),
    index: leftIndex,
  };
};
const buildPlaybackPoints = (
  points: TrackDetails["points"],
  maxPoints = 1800,
): TrackDetails["points"] => {
  if (points.length <= 2 || points.length <= maxPoints) return points;
  const totalDistance = Math.max(points[points.length - 1].distanceFromStartM, 1);
  const targetCount = Math.max(300, maxPoints);
  const interval = totalDistance / (targetCount - 1);
  const sampled: TrackDetails["points"] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const targetDistance = Math.min(totalDistance, i * interval);
    const interp = interpolatePointAtDistance(points, targetDistance);
    const nearest = points[interp.index] ?? points[0];
    sampled.push({
      lat: interp.lat,
      lon: interp.lon,
      ele: nearest.ele ?? null,
      time: null,
      distanceFromStartM: targetDistance,
    });
  }
  return sampled;
};
const smoothPlaybackPoints = (
  points: TrackDetails["points"],
  radius = 2,
): TrackDetails["points"] => {
  if (points.length <= 4 || radius <= 0) return points;
  const smoothed: TrackDetails["points"] = points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return point;
    let latSum = 0;
    let lonSum = 0;
    let wSum = 0;
    for (let j = -radius; j <= radius; j += 1) {
      const idx = clamp(i + j, 0, points.length - 1);
      const weight = radius + 1 - Math.abs(j);
      latSum += points[idx].lat * weight;
      lonSum += points[idx].lon * weight;
      wSum += weight;
    }
    return {
      ...point,
      lat: latSum / wSum,
      lon: lonSum / wSum,
    };
  });
  return smoothed;
};
const App = () => {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const routeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameMsRef = useRef<number | null>(null);
  const lastUiFrameMsRef = useRef<number | null>(null);
  const lastBearingRef = useRef<number | null>(null);
  const progressRef = useRef<number>(0);
  const routeCoordinatesRef = useRef<Array<[number, number]>>([]);
  const appliedSourceCoordCountRef = useRef<number>(0);
  const lastDiagnosticsSentMsRef = useRef<number>(0);
  const lastCameraUpdateMsRef = useRef<number>(0);
  const lastOverlayDrawMsRef = useRef<number>(0);
  const cameraStateRef = useRef<CameraState | null>(null);
  const playbackPointsRef = useRef<TrackDetails["points"]>([]);
  const hasPlayedRef = useRef<boolean>(false);

  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<TrackDetails | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(2);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [mapTypeId, setMapTypeId] = useState<OsRasterLayerId>(
    isOsRasterLayerId(configuredOsRasterLayer) ? configuredOsRasterLayer : "Outdoor_3857",
  );
  const [importUrl, setImportUrl] = useState("");
  const [cameraPresetId, setCameraPresetId] = useState<CameraPresetId>("cinematic");
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({
    selectedTrackId: null,
    selectedPointCount: 0,
    selectedDistanceM: 0,
    routeCoordCount: 0,
    mapLoaded: false,
    styleLoaded: false,
    sourcePresent: false,
    layerPresent: false,
    sourceCoordCount: 0,
    renderedFeatureCount: 0,
    cameraCenter: "n/a",
    cameraZoom: 0,
    cameraBearing: 0,
    cameraPitch: 0,
    viewBounds: "n/a",
    routeBounds: "n/a",
    progress: 0,
    playbackState: "idle",
    status: "Ready",
  });

  const cameraPreset = useMemo(
    () => cameraPresets.find((preset) => preset.id === cameraPresetId) ?? cameraPresets[1],
    [cameraPresetId],
  );

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedTrackId) ?? null,
    [tracks, selectedTrackId],
  );
  const displayZoom = (cameraPreset.zoomBase + zoomOffset).toFixed(2);

  const captureDiagnostics = (): DiagnosticsState => {
    const map = mapRef.current;
    const center = map?.getCenter();
    const bounds = map?.getBounds();
    const source = map?.getSource(sourceId) as (maplibregl.GeoJSONSource & {
      _data?: { geometry?: { coordinates?: unknown[] } };
    }) | null;
    const sourceCoordCount = appliedSourceCoordCountRef.current;
    let renderedFeatureCount = 0;
    if (map?.isStyleLoaded()) {
      renderedFeatureCount = map.queryRenderedFeatures(undefined, { layers: [layerId] }).length;
    }
    return {
      selectedTrackId,
      selectedPointCount: selectedDetails?.points.length ?? 0,
      selectedDistanceM: selectedDetails?.track.distanceM ?? 0,
      routeCoordCount: routeCoordinatesRef.current.length,
      mapLoaded: map?.loaded() ?? false,
      styleLoaded: map?.isStyleLoaded() ?? false,
      sourcePresent: Boolean(map?.getSource(sourceId)),
      layerPresent: Boolean(map?.getLayer(layerId)),
      sourceCoordCount,
      renderedFeatureCount,
      cameraCenter: center ? `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}` : "n/a",
      cameraZoom: map?.getZoom() ?? 0,
      cameraBearing: map?.getBearing() ?? 0,
      cameraPitch: map?.getPitch() ?? 0,
      viewBounds: bounds
        ? `${bounds.getSouth().toFixed(5)},${bounds.getWest().toFixed(5)} -> ${bounds
            .getNorth()
            .toFixed(5)},${bounds.getEast().toFixed(5)}`
        : "n/a",
      routeBounds: selectedDetails
        ? `${selectedDetails.track.bounds.minLat.toFixed(5)},${selectedDetails.track.bounds.minLon.toFixed(5)} -> ${selectedDetails.track.bounds.maxLat.toFixed(5)},${selectedDetails.track.bounds.maxLon.toFixed(5)}`
        : "n/a",
      progress: progressRef.current,
      playbackState,
      status,
    };
  };

  const pushDiagnostics = (event: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastDiagnosticsSentMsRef.current < 1_000) return;
    lastDiagnosticsSentMsRef.current = now;

    const snapshot = captureDiagnostics();
    setDiagnostics(snapshot);
    void postDiagnostics({
      event,
      details: {
        ...snapshot,
        cameraPresetId,
        mapTypeId,
        speed,
      },
    }).catch(() => {
      // Best-effort logging only.
    });
  };

  const applyRouteData = (): boolean => {
    const map = mapRef.current;
    if (!map) return false;

    const coords = routeCoordinatesRef.current;
    if (!coords || coords.length < 2) return false;

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!source || typeof source.setData !== "function") return false;

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
        },
      ],
    });
    appliedSourceCoordCountRef.current = coords.length;
    return true;
  };

  const drawRouteOverlay = (force = false, nowMs = performance.now()) => {
    const map = mapRef.current;
    const canvas = routeCanvasRef.current;
    const coords = routeCoordinatesRef.current;
    const details = selectedDetails;
    const playbackPoints =
      playbackPointsRef.current.length > 1 ? playbackPointsRef.current : details?.points ?? [];
    if (!map || !canvas || !details || coords.length < 2 || playbackPoints.length < 2) return;
    if (!force && nowMs - lastOverlayDrawMsRef.current < 16) return;
    lastOverlayDrawMsRef.current = nowMs;

    const width = map.getContainer().clientWidth;
    const height = map.getContainer().clientHeight;
    if (width <= 0 || height <= 0) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!hasPlayedRef.current && progressRef.current <= 0.0001) return;

    const totalDistance = Math.max(playbackPoints[playbackPoints.length - 1].distanceFromStartM, 1);
    const revealDistance = clamp(progressRef.current, 0, 1) * totalDistance;
    const revealLonLat: Array<[number, number]> = [];
    for (let i = 0; i < playbackPoints.length; i += 1) {
      const point = playbackPoints[i];
      if (point.distanceFromStartM <= revealDistance) {
        revealLonLat.push([point.lon, point.lat]);
        continue;
      }

      if (i > 0) {
        const prev = playbackPoints[i - 1];
        const span = Math.max(point.distanceFromStartM - prev.distanceFromStartM, 0.0001);
        const t = clamp((revealDistance - prev.distanceFromStartM) / span, 0, 1);
        revealLonLat.push([lerp(prev.lon, point.lon, t), lerp(prev.lat, point.lat, t)]);
      }
      break;
    }
    // Ensure the revealed line always reaches exact current progress point.
    const head = interpolatePointAtDistance(playbackPoints, revealDistance);
    if (revealLonLat.length === 0) {
      revealLonLat.push([head.lon, head.lat]);
    } else {
      const last = revealLonLat[revealLonLat.length - 1];
      if (last[0] !== head.lon || last[1] !== head.lat) {
        revealLonLat.push([head.lon, head.lat]);
      }
    }

    if (revealLonLat.length >= 2) {
      ctx.beginPath();
      for (let i = 0; i < revealLonLat.length; i += 1) {
        const [lon, lat] = revealLonLat[i];
        const pt = map.project([lon, lat]);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }

      // Trail casing
      ctx.strokeStyle = "rgba(10, 10, 10, 0.9)";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Trail core
      ctx.strokeStyle = "rgba(255, 64, 64, 0.98)";
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Glow disabled to prioritize smooth playback.
    }

    const headPx = map.project([head.lon, head.lat]);
    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    ctx.arc(headPx.x, headPx.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  };

  const ensureTrackLayers = () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const existingSource = map.getSource(sourceId);
    if (existingSource) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(layerCasingId)) map.removeLayer(layerCasingId);
      map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });

    map.addLayer({
      id: layerCasingId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#111111",
        "line-width": 10,
        "line-opacity": 0,
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    });

    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#ff4d4d",
        "line-width": 6.5,
        "line-opacity": 0,
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    });
  };

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
    pushDiagnostics("status-change", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapElRef.current,
      style: buildTerrainStyle(mapTypeId),
      center: [-2.6, 54.4],
      zoom: 5.5,
      pitch: 68,
      bearing: -20,
      maxPitch: 85,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      ensureTrackLayers();
      void applyRouteData();
      drawRouteOverlay(true);
      pushDiagnostics("map-load", true);
    });

    map.on("styledata", () => {
      if (!map.getSource(sourceId) || !map.getLayer(layerId)) {
        ensureTrackLayers();
        void applyRouteData();
        drawRouteOverlay(true);
        pushDiagnostics("styledata-rebuild", true);
      }
    });

    const handleResize = () => drawRouteOverlay(true);
    map.on("resize", handleResize);

    mapRef.current = map;

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      pushDiagnostics("map-unmount", true);
      map.off("resize", handleResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildTerrainStyle(mapTypeId));
    pushDiagnostics("map-style-change", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapTypeId]);

  useEffect(() => {
    if (!selectedTrackId) {
      setSelectedDetails(null);
      return;
    }

    setStatus("Loading selected track...");
    setPlaybackState("idle");
    setProgress(0);
    progressRef.current = 0;
    hasPlayedRef.current = false;
    lastBearingRef.current = null;
    cameraStateRef.current = null;

    void getTrackDetails(selectedTrackId)
      .then((details) => {
        setSelectedDetails(details);
        setStatus(`Loaded ${details.track.name}`);
        pushDiagnostics("track-details-loaded", true);
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : "Failed to load track details");
        pushDiagnostics("track-details-error", true);
      });
  }, [selectedTrackId]);

  useEffect(() => {
    const details = selectedDetails;
    if (!details) return;

    const sampled = buildPlaybackPoints(details.points, 1800);
    const smoothed = smoothPlaybackPoints(sampled, 2);
    playbackPointsRef.current = smoothed;
    const coords = smoothed.map((p) => [p.lon, p.lat] as [number, number]);
    routeCoordinatesRef.current = coords;

    const map = mapRef.current;
    if (!map) return;
    if (!applyRouteData()) {
      setTimeout(() => {
        if (applyRouteData()) {
          drawRouteOverlay(true);
          pushDiagnostics("route-applied-retry", true);
        }
      }, 250);
    }
    drawRouteOverlay(true);

    const b = details.track.bounds;
    const bounds: LngLatBoundsLike = [
      [b.minLon, b.minLat],
      [b.maxLon, b.maxLat],
    ];

    map.fitBounds(bounds, {
      padding: 40,
      maxZoom: 14,
      duration: 0,
      pitch: 68,
      bearing: 0,
    });

    // Snap camera to route start so playback always begins from visible geometry.
    lastBearingRef.current = null;
    updateCameraAtProgress(progressRef.current);
    pushDiagnostics("route-applied", true);
  }, [selectedDetails]);

  useEffect(() => {
    if (!selectedDetails) return;
    const timer = setInterval(() => {
      if (appliedSourceCoordCountRef.current < 2) {
        if (applyRouteData()) {
          drawRouteOverlay(true);
          pushDiagnostics("route-interval-reapply", true);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetails]);

  const updateCameraAtProgress = (value: number, nowMs = performance.now(), force = false) => {
    const details = selectedDetails;
    const map = mapRef.current;
    const playbackPoints =
      playbackPointsRef.current.length > 1 ? playbackPointsRef.current : details?.points ?? [];
    if (!details || !map || playbackPoints.length < 2) return;
    if (!force && nowMs - lastCameraUpdateMsRef.current < 16) return;
    lastCameraUpdateMsRef.current = nowMs;

    const totalDistance = Math.max(playbackPoints[playbackPoints.length - 1].distanceFromStartM, 1);
    const targetDistance = clamp(value, 0, 1) * totalDistance;
    const lookaheadDistance = cameraPreset.lookaheadMeters;
    const chaseDistance = cameraPreset.chaseMeters;

    const current = interpolatePointAtDistance(playbackPoints, targetDistance);
    const lookahead = interpolatePointAtDistance(playbackPoints, targetDistance + lookaheadDistance);
    const behind = interpolatePointAtDistance(playbackPoints, targetDistance - chaseDistance);

    const lookLon = lookahead.lon;
    const lookLat = lookahead.lat;
    const camLon = current.lon;
    const camLat = current.lat;

    const lookDistance = haversineMeters(camLat, camLon, lookLat, lookLon);
    const rawBearing =
      lookDistance < 5 && lastBearingRef.current !== null
        ? lastBearingRef.current
        : bearingDeg(camLat, camLon, lookLat, lookLon);
    const prevBearing = lastBearingRef.current;
    const smoothedBearing = (() => {
      if (prevBearing === null) return rawBearing;
      const desired =
        (prevBearing +
          shortestAngleDiff(prevBearing, rawBearing) * cameraPreset.bearingSmoothing +
          360) %
        360;
      const turnStep = clamp(shortestAngleDiff(prevBearing, desired), -2.5, 2.5);
      return (prevBearing + turnStep + 360) % 360;
    })();
    lastBearingRef.current = smoothedBearing;

    const zoom = clamp(cameraPreset.zoomBase + zoomOffset, cameraPreset.zoomMin, cameraPreset.zoomMax);

    const desiredLon = lerp(current.lon, behind.lon, 0.74);
    const desiredLat = lerp(current.lat, behind.lat, 0.74);
    const desiredPitch = cameraPreset.pitch;
    const follow = playbackState === "playing" ? 0.14 : 0.28;
    const prevCamera = cameraStateRef.current;
    const smoothedCamera: CameraState = prevCamera
      ? {
          lon: lerp(prevCamera.lon, desiredLon, follow),
          lat: lerp(prevCamera.lat, desiredLat, follow),
          zoom: lerp(prevCamera.zoom, zoom, follow),
          bearing:
            (prevCamera.bearing +
              shortestAngleDiff(prevCamera.bearing, smoothedBearing) * follow +
              360) %
            360,
          pitch: lerp(prevCamera.pitch, desiredPitch, follow),
        }
      : {
          lon: desiredLon,
          lat: desiredLat,
          zoom,
          bearing: smoothedBearing,
          pitch: desiredPitch,
        };
    cameraStateRef.current = smoothedCamera;

    map.jumpTo({
      center: [smoothedCamera.lon, smoothedCamera.lat],
      bearing: smoothedCamera.bearing,
      pitch: smoothedCamera.pitch,
      zoom: smoothedCamera.zoom,
    });
    drawRouteOverlay(false, nowMs);
    pushDiagnostics("camera-update");
  };

  useEffect(() => {
    if (playbackState !== "playing") {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameMsRef.current = null;
      lastUiFrameMsRef.current = null;
      pushDiagnostics("playback-stopped", true);
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
      updateCameraAtProgress(next, timestamp);

      const lastUiFrame = lastUiFrameMsRef.current;
      if (lastUiFrame === null || timestamp - lastUiFrame > 80 || next >= 1) {
        lastUiFrameMsRef.current = timestamp;
        setProgress(next);
      }

      if (next >= 1) {
        setPlaybackState("paused");
        pushDiagnostics("playback-ended", true);
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
  }, [playbackState, selectedDetails, speed, cameraPreset, zoomOffset]);

  useEffect(() => {
    if (!selectedDetails) return;
    updateCameraAtProgress(progressRef.current, performance.now(), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomOffset, cameraPresetId]);

  useEffect(() => {
    const timer = setInterval(() => {
      pushDiagnostics("interval");
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("Uploading GPX...");
    try {
      const track = await uploadTrack(file);
      setTracks((prev) => [track, ...prev]);
      setSelectedTrackId(track.id);
      setStatus(`Uploaded ${track.name}`);
      pushDiagnostics("upload-success", true);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
      pushDiagnostics("upload-error", true);
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
      pushDiagnostics("import-success", true);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "URL import failed");
      pushDiagnostics("import-error", true);
    }
  };

  const togglePlay = () => {
    if (!selectedDetails) return;

    if (playbackState === "playing") {
      setPlaybackState("paused");
      pushDiagnostics("play-pause-click", true);
      return;
    }

    if (progress >= 1) {
      setProgress(0);
      progressRef.current = 0;
      lastBearingRef.current = null;
      updateCameraAtProgress(0, performance.now(), true);
    }

    if (progress < 1) {
      progressRef.current = progress;
    }
    hasPlayedRef.current = true;

    setPlaybackState("playing");
    pushDiagnostics("play-start-click", true);
  };

  const onScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value) / 100;
    hasPlayedRef.current = hasPlayedRef.current || next > 0;
    setProgress(next);
    progressRef.current = next;
    updateCameraAtProgress(next, performance.now(), true);
    pushDiagnostics("scrub", true);
  };

  const onDeleteTrack = async (trackId: string) => {
    if (deletingTrackId) return;
    setDeletingTrackId(trackId);
    try {
      await deleteTrack(trackId);
      let nextSelectedId: string | null = selectedTrackId;
      let remainingCount = 0;
      setTracks((prev) => {
        const remaining = prev.filter((track) => track.id !== trackId);
        remainingCount = remaining.length;
        if (selectedTrackId === trackId) {
          nextSelectedId = remaining[0]?.id ?? null;
        }
        return remaining;
      });
      if (selectedTrackId === trackId) {
        setSelectedTrackId(nextSelectedId);
        if (remainingCount === 0) {
          setSelectedDetails(null);
          setStatus("Track deleted");
        }
      }
      pushDiagnostics("track-delete-success", true);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Failed to delete track");
      pushDiagnostics("track-delete-error", true);
    } finally {
      setDeletingTrackId(null);
    }
  };

  const onZoomIn = () => {
    setZoomOffset((prev) => clamp(prev + 0.2, -1.5, 1.5));
  };

  const onZoomOut = () => {
    setZoomOffset((prev) => clamp(prev - 0.2, -1.5, 1.5));
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
                <span
                  className="track-delete"
                  role="button"
                  aria-label={`Delete ${track.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onDeleteTrack(track.id);
                  }}
                >
                  {deletingTrackId === track.id ? "..." : "x"}
                </span>
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
        <canvas ref={routeCanvasRef} className="route-canvas" />

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
          <select
            className="select"
            value={mapTypeId}
            onChange={(e) => setMapTypeId(e.target.value as OsRasterLayerId)}
            disabled={!osApiKey}
          >
            {!osApiKey ? (
              <option value="Outdoor_3857">OS key required</option>
            ) : (
              osLayerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))
            )}
          </select>
          <div className="zoom-controls">
            <button className="button" onClick={onZoomOut} type="button">
              Zoom -
            </button>
            <span className="zoom-readout">{displayZoom}</span>
            <button className="button" onClick={onZoomIn} type="button">
              Zoom +
            </button>
          </div>
        </div>
        <div className="diagnostics">
          <strong>Diagnostics</strong>
          <div>trackId: {diagnostics.selectedTrackId ?? "none"}</div>
          <div>points: {diagnostics.selectedPointCount}</div>
          <div>distanceM: {diagnostics.selectedDistanceM.toFixed(2)}</div>
          <div>routeCoords: {diagnostics.routeCoordCount}</div>
          <div>mapLoaded/styleLoaded: {String(diagnostics.mapLoaded)} / {String(diagnostics.styleLoaded)}</div>
          <div>source/layer: {String(diagnostics.sourcePresent)} / {String(diagnostics.layerPresent)}</div>
          <div>sourceCoordCount: {diagnostics.sourceCoordCount}</div>
          <div>renderedFeatureCount: {diagnostics.renderedFeatureCount}</div>
          <div>center: {diagnostics.cameraCenter}</div>
          <div>
            zoom/bearing/pitch: {diagnostics.cameraZoom.toFixed(2)} / {diagnostics.cameraBearing.toFixed(1)} /{" "}
            {diagnostics.cameraPitch.toFixed(1)}
          </div>
          <div>viewBounds: {diagnostics.viewBounds}</div>
          <div>routeBounds: {diagnostics.routeBounds}</div>
          <div>progress/state: {diagnostics.progress.toFixed(3)} / {diagnostics.playbackState}</div>
          <div>status: {diagnostics.status}</div>
        </div>
      </main>
    </div>
  );
};

export default App;
