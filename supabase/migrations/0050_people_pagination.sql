-- The People admin list was hardcoded to the newest 50 matches with no way to page further and no
-- indication how many people exist in total — fine for a handful of test accounts, not for a real
-- rollout with lakhs of sign-ups. Add real offset pagination with a total count, and trigram
-- indexes so name/organisation search stays fast as the table grows.

create extension if not exists pg_trgm;
create index if not exists profiles_display_name_trgm on public.profiles using gin (display_name gin_trgm_ops);
create index if not exists profiles_org_name_trgm on public.profiles using gin (org_name gin_trgm_ops);

create or replace function public.admin_list_users(p_query text default null, p_offset integer default 0, p_limit integer default 50)
returns table (id uuid, display_name text, email text, role public.user_role, banned boolean, verified boolean,
  points integer, reports bigint, is_guest boolean, created_at timestamptz, account_type text, org_name text, total_count bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_limit not between 1 and 200 then raise exception 'p_limit must be between 1 and 200'; end if;
  return query
  select p.id, p.display_name, u.email::text, p.role, p.banned, p.verified, p.points,
    (select count(*) from public.issues i where i.author_id = p.id), coalesce(u.is_anonymous, false), p.created_at, p.account_type, p.org_name,
    count(*) over ()
  from public.profiles p join auth.users u on u.id = p.id
  where p_query is null or p_query = ''
     or p.display_name ilike '%' || p_query || '%' or u.email ilike '%' || p_query || '%' or p.org_name ilike '%' || p_query || '%'
  order by p.created_at desc
  limit p_limit offset greatest(p_offset, 0);
end;
$$;
revoke execute on function public.admin_list_users(text, integer, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;

-- The old 1-arg signature is no longer called from the client, but drop it explicitly so there
-- are not two overloads with diverging behaviour sitting in the schema.
drop function if exists public.admin_list_users(text);
