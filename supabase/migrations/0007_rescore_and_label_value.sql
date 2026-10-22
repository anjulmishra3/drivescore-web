-- Numeric value for road-context labels (e.g. speed_limit km/h).
alter table public.trip_labels add column if not exists value double precision;

-- Server-side re-score mirroring src/lib/scoring.ts: de-aliased longitudinal g
-- (differentiate only across real GPS speed updates), debounced harsh events,
-- gravity-removed cornering, and Focus (phone-off-mount) detection. One-time /
-- offline re-score tool; new trips are scored by the TS at finish.
create or replace function public.rescore_trip(p_trip uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  rec record;
  first_t bigint; last_t bigint;
  dist double precision := 0; maxsp double precision := 0; step double precision; dt double precision;
  h_accel int := 0; h_brake int := 0; h_corner int := 0;
  spd_samples int := 0; speeding_samples int := 0;
  gx double precision; gy double precision; gz double precision; g_init boolean := false;
  refspeed double precision; reft bigint;
  last_accel_t bigint := -1000000000000000; last_brake_t bigint := -1000000000000000; last_corner_t bigint := -1000000000000000;
  sp double precision; gap double precision; along double precision; lx double precision; ly double precision; lat_g double precision;
  drate double precision; sm int; br int; co int; spd int; fo int; ov int; dur int;
  base_x double precision; base_y double precision; base_z double precision; bmag double precision; have_base boolean;
  handling boolean := false; hand_start bigint; phone_seconds double precision := 0;
  accel_samples int := 0; near_base int := 0; gmag double precision; cosv double precision; devdeg double precision;
begin
  select avg(accel_x), avg(accel_y), avg(accel_z) into base_x, base_y, base_z
  from public.trip_samples where trip_id = p_trip and accel_x is not null and accel_y is not null and accel_z is not null;
  have_base := base_x is not null;
  bmag := greatest(sqrt(coalesce(base_x,0)^2 + coalesce(base_y,0)^2 + coalesce(base_z,0)^2), 1e-9);

  for rec in
    select t_ms, lat, lng, speed_kmh, accel_x, accel_y, accel_z,
           lag(t_ms) over w p_t, lag(lat) over w p_lat, lag(lng) over w p_lng
    from public.trip_samples where trip_id = p_trip window w as (order by seq) order by seq
  loop
    if first_t is null then first_t := rec.t_ms; end if;
    last_t := rec.t_ms;
    if rec.p_t is null then continue; end if;
    dt := (rec.t_ms - rec.p_t)/1000.0;
    if dt <= 0 then continue; end if;

    if rec.p_lat is not null and rec.lat is not null then
      step := 2*6371*asin(least(1, sqrt(power(sin(radians(rec.lat-rec.p_lat)/2),2)
              + cos(radians(rec.p_lat))*cos(radians(rec.lat))*power(sin(radians(rec.lng-rec.p_lng)/2),2))));
      if step <= 0.5 or step/(dt/3600.0) <= 250 then dist := dist + step; end if;
    end if;

    sp := rec.speed_kmh;
    if sp is not null and sp <= 250 then
      if sp > maxsp then maxsp := sp; end if;
      if sp >= 4 then
        spd_samples := spd_samples + 1;
        if sp > 120 then speeding_samples := speeding_samples + 1; end if;
      end if;
      if refspeed is null then refspeed := sp; reft := rec.t_ms;
      elsif sp <> refspeed then
        gap := (rec.t_ms - reft)/1000.0;
        if gap > 0 and gap <= 5 and sp >= 4 then
          along := ((sp - refspeed)*1000/3600.0)/gap/9.81;
          if along > 0.30 and (rec.t_ms - last_accel_t) > 1500 then h_accel := h_accel+1; last_accel_t := rec.t_ms; end if;
          if -along > 0.35 and (rec.t_ms - last_brake_t) > 1500 then h_brake := h_brake+1; last_brake_t := rec.t_ms; end if;
        end if;
        refspeed := sp; reft := rec.t_ms;
      end if;
    end if;

    if rec.accel_x is not null and rec.accel_y is not null and rec.accel_z is not null then
      if not g_init then gx := rec.accel_x; gy := rec.accel_y; gz := rec.accel_z; g_init := true; end if;
      gx := gx + 0.02*(rec.accel_x - gx);
      gy := gy + 0.02*(rec.accel_y - gy);
      gz := gz + 0.02*(rec.accel_z - gz);
      lx := rec.accel_x - gx; ly := rec.accel_y - gy;
      lat_g := sqrt(lx*lx + ly*ly)/9.81;
      if coalesce(sp,0) >= 8 and lat_g > 0.35 and (rec.t_ms - last_corner_t) > 1500 then
        h_corner := h_corner+1; last_corner_t := rec.t_ms;
      end if;

      if have_base then
        accel_samples := accel_samples + 1;
        gmag := greatest(sqrt(gx*gx+gy*gy+gz*gz), 1e-9);
        cosv := greatest(-1, least(1, (gx*base_x+gy*base_y+gz*base_z)/(gmag*bmag)));
        devdeg := degrees(acos(cosv));
        if devdeg < 15 then near_base := near_base + 1; end if;
        if devdeg > 25 then
          if not handling then handling := true; hand_start := rec.t_ms; end if;
        elsif handling then
          if (rec.t_ms - hand_start)/1000.0 >= 1.0 then phone_seconds := phone_seconds + (rec.t_ms - hand_start)/1000.0; end if;
          handling := false;
        end if;
      end if;
    end if;
  end loop;

  if handling and have_base and (coalesce(last_t,0) - hand_start)/1000.0 >= 1.0 then
    phone_seconds := phone_seconds + (last_t - hand_start)/1000.0;
  end if;

  dur := round((coalesce(last_t,0) - coalesce(first_t,0))/1000.0);
  drate := greatest(dist, 1);
  sm  := greatest(0, least(100, round(100 - (h_accel/drate)*50)));
  br  := greatest(0, least(100, round(100 - (h_brake/drate)*55)));
  co  := greatest(0, least(100, round(100 - (h_corner/drate)*45)));
  spd := greatest(0, least(100, round(100 - case when spd_samples>0 then speeding_samples::numeric/spd_samples*100 else 0 end)));
  if have_base and accel_samples > 0 and near_base::numeric/accel_samples >= 0.4 then
    fo := greatest(0, least(100, round(100 - (phone_seconds/greatest(dur,1))*150)));
  else
    fo := 100;
  end if;
  ov  := greatest(0, least(100, round(sm*0.25 + br*0.25 + co*0.2 + spd*0.2 + fo*0.1)));

  update public.trips set
    distance_km = round(dist::numeric,2), duration_s = dur, max_speed_kmh = round(maxsp::numeric,2),
    score_smoothness = sm, score_braking = br, score_cornering = co, score_speeding = spd, score_focus = fo,
    overall_score = ov, event_count = h_accel + h_brake + h_corner
  where id = p_trip;
end $$;
