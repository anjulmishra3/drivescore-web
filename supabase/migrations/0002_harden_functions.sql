-- Security hardening flagged by the Supabase advisor after 0001.

-- Pin search_path on the trigger helper (was flagged mutable).
alter function public.set_updated_at() set search_path = '';

-- handle_new_user is only ever invoked by the auth.users trigger. It must not
-- be callable as an RPC by anon/authenticated. Triggers still fire regardless
-- of these EXECUTE grants because they run as the table owner.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
