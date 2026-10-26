"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LMap, CircleMarker, Polyline } from "leaflet";

export interface RoutePoint { t_ms: number; lat: number; lng: number; speed_kmh?: number | null }

export interface MapLabel {
  id: string;
  lat: number | null;
  lng: number | null;
  type: string | null;
  source: "auto" | "manual";
  confirmed: boolean | null;
}

function colorFor(l: MapLabel) {
  if (l.confirmed === true) return "#16a34a";
  if (l.confirmed === false) return "#dc2626";
  if (l.source === "manual") return "#1f66f5";
  return "#f59e0b"; // unanswered auto
}

export default function RouteMap({
  route,
  labels,
  selectedId,
  onSelect,
  onAddAt,
  highlight,
}: {
  route: RoutePoint[];
  labels: MapLabel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddAt?: (pt: RoutePoint) => void;
  highlight?: { lat: number; lng: number } | null;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const markersRef = useRef<Record<string, CircleMarker>>({});
  const lineRef = useRef<Polyline | null>(null);
  const hitRef = useRef<Polyline | null>(null);
  const tempRef = useRef<CircleMarker | null>(null);
  // keep latest route/labels/handlers without re-binding the map click
  const routeRef = useRef<RoutePoint[]>(route);
  const labelsRef = useRef<MapLabel[]>(labels);
  const addRef = useRef<typeof onAddAt>(onAddAt);
  const selectRef = useRef(onSelect);
  const fittedRef = useRef(false);
  routeRef.current = route;
  labelsRef.current = labels;
  addRef.current = onAddAt;
  selectRef.current = onSelect;

  function nearest(lat: number, lng: number): RoutePoint | null {
    let best: RoutePoint | null = null, bd = Infinity;
    for (const p of routeRef.current) {
      const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // A click near an existing label selects it (→ its tile); otherwise it adds a
  // new label at the nearest route point. Proximity is measured in screen pixels
  // so it's zoom-independent.
  function handleClick(latlng: { lat: number; lng: number }) {
    const map = mapRef.current;
    if (!map) return;
    const clickPt = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
    let bestId: string | null = null, bestPx = Infinity;
    for (const l of labelsRef.current) {
      if (l.lat == null || l.lng == null) continue;
      const d = clickPt.distanceTo(map.latLngToContainerPoint([l.lat, l.lng]));
      if (d < bestPx) { bestPx = d; bestId = l.id; }
    }
    if (bestId && bestPx <= 22) { selectRef.current(bestId); return; }
    if (addRef.current) { const p = nearest(latlng.lat, latlng.lng); if (p) addRef.current(p); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap",
      }).addTo(map);
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => handleClick(e.latlng));
      mapRef.current = map;
      draw(L);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      if (mapRef.current) draw(L);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, labels]);

  // temp "about to add" marker
  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;
      if (tempRef.current) { tempRef.current.remove(); tempRef.current = null; }
      if (highlight) {
        tempRef.current = L.circleMarker([highlight.lat, highlight.lng], {
          radius: 10, weight: 3, color: "#1f66f5", fillColor: "#bcdcff", fillOpacity: 0.9,
        }).addTo(map);
        map.panTo([highlight.lat, highlight.lng]);
      }
    })();
  }, [highlight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const m = markersRef.current[selectedId];
    if (m) { map.panTo(m.getLatLng()); m.setStyle({ weight: 4, radius: 10 }); m.bringToFront(); }
    return () => { if (m) m.setStyle({ weight: 2, radius: 7 }); };
  }, [selectedId]);

  function draw(L: typeof import("leaflet")) {
    const map = mapRef.current!;
    [lineRef, hitRef].forEach((r) => { if (r.current) { r.current.remove(); r.current = null; } });
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    const coords = route.map((p) => [p.lat, p.lng] as [number, number]);
    if (coords.length > 1) {
      lineRef.current = L.polyline(coords, { color: "#1f66f5", weight: 3, opacity: 0.85 }).addTo(map);
      // wide invisible hit line so tapping near the route registers
      hitRef.current = L.polyline(coords, { color: "#000", weight: 22, opacity: 0 }).addTo(map);
      hitRef.current.on("click", (e: { latlng: { lat: number; lng: number } }) => handleClick(e.latlng));
    }

    for (const l of labels) {
      if (l.lat == null || l.lng == null) continue;
      const m = L.circleMarker([l.lat, l.lng], {
        radius: 7, weight: 2, color: "#ffffff", fillColor: colorFor(l), fillOpacity: 1,
      }).addTo(map);
      m.bindTooltip(`${(l.type ?? "?").replace("_", " ")} · ${l.source}`, { direction: "top" });
      m.on("click", () => onSelect(l.id));
      markersRef.current[l.id] = m;
    }

    // Fit the view only on the first draw; afterwards keep the user's zoom/pan so
    // editing labels (which re-renders) doesn't reset the map.
    if (!fittedRef.current) {
      const b = lineRef.current?.getBounds();
      if (b && b.isValid()) { map.fitBounds(b, { padding: [30, 30] }); fittedRef.current = true; }
      else if (labels.some((l) => l.lat != null)) {
        const pts = labels.filter((l) => l.lat != null).map((l) => [l.lat!, l.lng!] as [number, number]);
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
        fittedRef.current = true;
      } else map.setView([15.3, 73.9], 11);
    }
  }

  return <div ref={elRef} className="h-80 w-full rounded-xl" style={{ zIndex: 0 }} />;
}
