// Shared types for the DriveScore data model. These mirror the SQL schema in
// supabase/migrations/0001_init.sql and form the API contract that the future
// v1 Android app reuses unchanged.

export type TripSource = "calibration" | "quick" | "obd";
export type TripStatus = "recording" | "completed" | "discarded";
export type DeviceStatus = "unpaired" | "paired" | "disconnected";

export interface Profile {
  id: string;
  display_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  notify_trip_summary: boolean;
  notify_weekly_digest: boolean;
  notify_device_alerts: boolean;
  share_anonymized_data: boolean;
  store_raw_samples: boolean;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  name: string;
  ble_id: string | null;
  status: DeviceStatus;
  last_seen_at: string | null;
  created_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  source: TripSource;
  status: TripStatus;
  started_at: string;
  ended_at: string | null;
  distance_km: number | null;
  duration_s: number | null;
  max_speed_kmh: number | null;
  overall_score: number | null;
  score_smoothness: number | null;
  score_braking: number | null;
  score_cornering: number | null;
  score_speeding: number | null;
  score_focus: number | null;
  event_count: number;
  created_at: string;
}

// A single sensor sample captured in the foreground (quick / calibration trip).
export interface TripSample {
  t_ms: number;
  lat?: number | null;
  lng?: number | null;
  speed_kmh?: number | null;
  accel_x?: number | null;
  accel_y?: number | null;
  accel_z?: number | null;
  gyro_alpha?: number | null;
  gyro_beta?: number | null;
  gyro_gamma?: number | null;
}

// The five sub-scores plus overall — the canonical score shape.
export interface ScoreBreakdown {
  overall_score: number;
  score_smoothness: number;
  score_braking: number;
  score_cornering: number;
  score_speeding: number;
  score_focus: number;
  event_count: number;
  distance_km: number;
  duration_s: number;
  max_speed_kmh: number;
}

export const SUB_SCORES: { key: keyof ScoreBreakdown; label: string; hint: string }[] = [
  { key: "score_smoothness", label: "Smoothness", hint: "Gentle acceleration" },
  { key: "score_braking", label: "Braking", hint: "No harsh stops" },
  { key: "score_cornering", label: "Cornering", hint: "Smooth turns" },
  { key: "score_speeding", label: "Speed", hint: "Within limits" },
  { key: "score_focus", label: "Focus", hint: "No phone handling" },
];
