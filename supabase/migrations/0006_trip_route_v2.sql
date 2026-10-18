-- Extend trip_route to carry t_ms + speed so a tapped map point can be saved as
-- a label at the right time. Return-type change requires drop+create.
drop function if exists public.trip_route(uuid, int);

create function public.trip_route(p_trip uuid, p_max int default 800)
returns table(t_ms bigint, lat double precision, lng double precision, speed_kmh double precision)
language sql stable security invoker
set search_path = public
as $$
  with pts as (
    select s.t_ms, s.lat, s.lng, s.speed_kmh,
           row_number() over (order by s.seq) as rn,
           count(*) over () as c
    from public.trip_samples s
    where s.trip_id = p_trip and s.lat is not null
  )
  select t_ms, lat, lng, speed_kmh from pts
  where rn % greatest(1, (c / greatest(p_max, 1))::int) = 0
  order by rn;
$$;
