-- Verified business accounts could pass verification (their sign-up hint says "Shops, offices and
-- companies doing civic work") but could not actually host an event — can_host_events() left
-- "business" out while every other organisation type was included. Adding it.
create or replace function public.can_host_events() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.verified and not p.banned
    and p.account_type in ('community', 'ngo', 'education', 'government', 'business'));
$$;
