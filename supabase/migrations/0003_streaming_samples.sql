-- Support resilient, resumable sample streaming for long trips.
--
-- Each sample carries a per-trip monotonic `seq` assigned by the client. A
-- unique (trip_id, seq) index makes batch uploads idempotent: retries and
-- overlapping flushes ON CONFLICT DO NOTHING instead of duplicating rows, so
-- "send again after a network blip" never double-counts a data point.

alter table public.trip_samples
  add column if not exists seq bigint;

create unique index if not exists trip_samples_trip_seq_uidx
  on public.trip_samples (trip_id, seq);
