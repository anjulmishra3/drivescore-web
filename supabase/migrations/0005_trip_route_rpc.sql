-- Downsampled GPS route for a trip, for plotting on the review map.
-- SECURITY INVOKER so the caller's RLS on trip_samples still applies.
create or replace function public.trip_route(p_trip uuid, p_max int default 800)
returns table(lat double precision, lng double precision)
language sql stable security invoker
set search_path = public
as $$
  with pts as (
    select s.lat, s.lng,
           row_number() over (order by s.seq) as rn,
           count(*) over () as c
    from public.trip_samples s
    where s.trip_id = p_trip and s.lat is not null
  )
  select lat, lng from pts
  where rn % greatest(1, (c / greatest(p_max, 1))::int) = 0
  order by rn;
$$;
