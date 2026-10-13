"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LMap, CircleMarker, Polyline } from "leaflet";

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
  return "#f59e0b"; // unanswered
}

export default function RouteMap({
  route,
  labels,
  selectedId,
  onSelect,
}: {
  route: [number, number][];
  labels: MapLabel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const markersRef = useRef<Record<string, CircleMarker>>({});
  const lineRef = useRef<Polyline | null>(null);

  // init once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      mapRef.current = map;
      draw(L);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // redraw when data changes
  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      if (mapRef.current) draw(L);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, labels]);

  // highlight + pan to selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const m = markersRef.current[selectedId];
    if (m) {
      map.panTo(m.getLatLng());
      m.setStyle({ weight: 4, radius: 10 });
      m.bringToFront();
    }
    return () => { if (m) m.setStyle({ weight: 2, radius: 7 }); };
  }, [selectedId]);

  function draw(L: typeof import("leaflet")) {
    const map = mapRef.current!;
    if (lineRef.current) { lineRef.current.remove(); lineRef.current = null; }
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    if (route.length > 1) {
      lineRef.current = L.polyline(route, { color: "#1f66f5", weight: 3, opacity: 0.8 }).addTo(map);
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

    const bounds = lineRef.current?.getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    else if (labels.length) {
      const pts = labels.filter((l) => l.lat != null).map((l) => [l.lat!, l.lng!] as [number, number]);
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView([15.3, 73.9], 11); // fallback: Goa
    }
  }

  return <div ref={elRef} className="h-72 w-full rounded-xl" style={{ zIndex: 0 }} />;
}
