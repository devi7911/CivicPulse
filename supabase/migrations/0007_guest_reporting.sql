-- Guest reporting: people can report without creating an account. The app signs them in with a
-- Supabase anonymous session in the background; they can add an email later to keep their reports.
-- Guests get tighter limits because creating a guest session costs an attacker nothing.

create or replace function public.is_guest(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select is_anonymous from auth.users where id = p_user), false);
$$;
revoke execute on function public.is_guest(uuid) from public, anon, authenticated;

-- Guests are named "Guest citizen" until they save their account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  dn text := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if new.is_anonymous then dn := 'Guest citizen'; end if;
  if char_length(dn) < 2 then dn := 'Citizen'; end if;
  insert into public.profiles (id, display_name) values (new.id, left(dn, 60));
  insert into public.profile_private (id) values (new.id);
  return new;
end;
$$;

-- Report limits: 10 a day for accounts, 3 a day per guest, and at most 60 guest reports an hour in
-- total, so a script creating throwaway guest sessions cannot flood the feed.
create or replace function public.check_report_limits()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  guest boolean := public.is_guest(new.author_id);
  mine integer;
  guest_hour integer;
begin
  select count(*) into mine from public.issues
  where author_id = new.author_id and created_at >= now() - interval '1 day';
  if guest and mine >= 3 then
    raise exception 'Guests can file 3 reports a day. Add your email in Profile to report more.';
  end if;
  if guest then
    select count(*) into guest_hour from public.issues i
    join auth.users u on u.id = i.author_id
    where u.is_anonymous and i.created_at >= now() - interval '1 hour';
    if guest_hour >= 60 then
      raise exception 'Too many guest reports right now. Please try again shortly, or sign in.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_report_limits() from public, anon, authenticated;
-- Runs before issues_bi (triggers fire in name order), which keeps the 10-a-day limit for everyone.
create trigger issues_a_limits before insert on public.issues
  for each row execute function public.check_report_limits();

-- Guests can comment, but less.
create or replace function public.check_guest_comments()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_guest(new.author_id) and (select count(*) from public.comments
      where author_id = new.author_id and created_at >= now() - interval '1 day') >= 5 then
    raise exception 'Guests can post 5 comments a day. Add your email in Profile to comment more.';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_guest_comments() from public, anon, authenticated;
create trigger comments_a_guest before insert on public.comments
  for each row execute function public.check_guest_comments();

-- ID verification needs a saved account.
create or replace function public.verification_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_guest(new.user_id) then
    raise exception 'Save your account with an email before asking to be verified';
  end if;
  if (select verified from public.profiles where id = new.user_id) then
    raise exception 'You are already verified';
  end if;
  if new.doc_path is null or split_part(new.doc_path, '/', 1) <> new.user_id::text then
    raise exception 'Invalid document path';
  end if;
  new.status := 'pending';
  new.note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.created_at := now();
  return new;
end;
$$;

-- When a guest saves their account with a real name, keep the profile name in step.
create or replace function public.handle_user_upgraded()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  dn text := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if old.is_anonymous and not new.is_anonymous and char_length(dn) >= 2 then
    update public.profiles set display_name = left(dn, 60) where id = new.id and display_name = 'Guest citizen';
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_user_upgraded() from public, anon, authenticated;
create trigger on_auth_user_upgraded
  after update of is_anonymous on auth.users
  for each row execute function public.handle_user_upgraded();
