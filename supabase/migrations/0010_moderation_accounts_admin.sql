-- Moderation (hide content, abuse flags), bans, admin user management, audit log, canned replies,
-- editing/deleting your own content, and account deletion/export (DPDP data rights).

-- ---------------------------------------------------------------------------------------------
-- Let reports outlive a deleted account (they become anonymous) instead of disappearing.
-- ---------------------------------------------------------------------------------------------
alter table public.issues alter column author_id drop not null;
alter table public.issues drop constraint issues_author_id_fkey;
alter table public.issues add constraint issues_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;

create or replace function public.award_points(p_user uuid, p_delta integer, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  earned_today integer;
  applied integer := p_delta;
begin
  if p_user is null then return; end if;
  if p_delta > 0 then
    select coalesce(sum(delta), 0) into earned_today
    from public.points_ledger
    where user_id = p_user and delta > 0 and created_at >= date_trunc('day', now());
    applied := least(p_delta, greatest(0, 100 - earned_today));
  end if;
  if applied = 0 then return; end if;
  insert into public.points_ledger (user_id, delta, reason) values (p_user, applied, p_reason);
  update public.profiles set points = greatest(0, points + applied) where id = p_user;
end;
$$;
revoke execute on function public.award_points(uuid, integer, text) from public, anon, authenticated;

create or replace function public.notify_issue(p_issue uuid, p_kind text, p_title text, p_body text, p_except uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, issue_id, kind, title, body)
  select distinct u.id, p_issue, p_kind, left(p_title, 140), left(p_body, 300)
  from (
    select author_id as id from public.issues where id = p_issue
    union
    select user_id from public.issue_follows where issue_id = p_issue
  ) u
  where u.id is not null and u.id is distinct from p_except;
end;
$$;
revoke execute on function public.notify_issue(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Bans
-- ---------------------------------------------------------------------------------------------
alter table public.profiles add column banned boolean not null default false;

create or replace function public.is_banned()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select banned from public.profiles where id = (select auth.uid())), false);
$$;
grant execute on function public.is_banned() to authenticated;

create policy "not banned: report" on public.issues as restrictive for insert to authenticated with check (not (select public.is_banned()));
create policy "not banned: comment" on public.comments as restrictive for insert to authenticated with check (not (select public.is_banned()));
create policy "not banned: back" on public.issue_upvotes as restrictive for insert to authenticated with check (not (select public.is_banned()));
create policy "not banned: photo" on public.issue_photos as restrictive for insert to authenticated with check (not (select public.is_banned()));

-- Reporters may add extra photos to their own report even as a guest.
drop policy "accounts only: add photo" on public.issue_photos;
create policy "accounts only: add photo" on public.issue_photos as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
    or exists (select 1 from public.issues i where i.id = issue_id and i.author_id = (select auth.uid())));

-- ---------------------------------------------------------------------------------------------
-- Hiding content
-- ---------------------------------------------------------------------------------------------
alter table public.issues add column hidden boolean not null default false, add column hidden_reason text;
alter table public.comments add column hidden boolean not null default false;
grant select (hidden, hidden_reason) on public.issues to anon, authenticated;

drop policy "issues readable unless confidential" on public.issues;
create policy "issues readable unless confidential or hidden" on public.issues for select
  using ((not confidential and not hidden) or author_id = (select auth.uid()) or (select public.is_admin()));

drop policy "comments readable by all" on public.comments;
create policy "comments readable unless hidden" on public.comments for select
  using (not hidden or author_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- Abuse flags. Five flags from different people hide the item until an admin reviews it.
-- ---------------------------------------------------------------------------------------------
create table public.content_flags (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('issue', 'comment', 'proposal')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'abusive', 'false', 'personal_info', 'other')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index on public.content_flags (target_type, target_id);
create index on public.content_flags (status, created_at);

alter table public.content_flags enable row level security;
revoke all on public.content_flags from anon, authenticated;
grant select on public.content_flags to authenticated;
grant insert (reporter_id, target_type, target_id, reason, note) on public.content_flags to authenticated;
create policy "flag as self" on public.content_flags for insert to authenticated
  with check (reporter_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "read own flags or admin" on public.content_flags for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.flags_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  select count(*) into n from public.content_flags
  where target_type = new.target_type and target_id = new.target_id and status = 'open';
  if n >= 5 then
    if new.target_type = 'issue' then
      update public.issues set hidden = true, hidden_reason = 'Hidden automatically after several reports. Awaiting review.'
      where id = new.target_id and not hidden;
    elsif new.target_type = 'comment' then
      update public.comments set hidden = true where id = new.target_id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.flags_after_insert() from public, anon, authenticated;
create trigger flags_ai after insert on public.content_flags for each row execute function public.flags_after_insert();

-- ---------------------------------------------------------------------------------------------
-- Audit log of admin actions
-- ---------------------------------------------------------------------------------------------
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.admin_audit (created_at desc);
create index on public.admin_audit (actor_id);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
grant select on public.admin_audit to authenticated;
create policy "admins read audit" on public.admin_audit for select to authenticated using ((select public.is_admin()));

create or replace function public.log_admin(p_action text, p_type text, p_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.admin_audit (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.log_admin(text, text, text, jsonb) from public, anon, authenticated;

-- Generic trigger for admin-managed tables.
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record := case when tg_op = 'DELETE' then old else new end;
begin
  if (select auth.uid()) is null then return r; end if;
  perform public.log_admin(lower(tg_op), tg_table_name, (to_jsonb(r) ->> 'id'),
    jsonb_build_object('title', coalesce(to_jsonb(r) ->> 'title', to_jsonb(r) ->> 'name')));
  return r;
end;
$$;
revoke execute on function public.audit_row() from public, anon, authenticated;
create trigger events_audit after insert or update or delete on public.events for each row execute function public.audit_row();
create trigger ngos_audit after insert or update or delete on public.ngos for each row execute function public.audit_row();
create trigger sponsored_audit after insert or update or delete on public.sponsored_posts for each row execute function public.audit_row();
create trigger helplines_audit after insert or update or delete on public.helplines for each row execute function public.audit_row();
create trigger links_audit after insert or update or delete on public.utility_links for each row execute function public.audit_row();

create or replace function public.issues_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select public.is_admin()) and (new.status is distinct from old.status or new.assignee is distinct from old.assignee
      or new.target_date is distinct from old.target_date) then
    perform public.log_admin('update', 'issues', new.id::text, jsonb_build_object(
      'ref', new.ref_no, 'status', new.status, 'from', old.status, 'assignee', new.assignee, 'target_date', new.target_date));
  end if;
  return new;
end;
$$;
revoke execute on function public.issues_audit() from public, anon, authenticated;
create trigger issues_audit_au after update on public.issues for each row execute function public.issues_audit();

-- ---------------------------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------------------------
create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_type = 'issue' then
    update public.issues set hidden = p_hide, hidden_reason = case when p_hide then left(coalesce(p_reason, 'Hidden by a moderator.'), 200) end where id = p_id;
  elsif p_type = 'comment' then
    update public.comments set hidden = p_hide where id = p_id;
  elsif p_type = 'proposal' then
    update public.proposals set hidden = p_hide where id = p_id;
  else
    raise exception 'Unknown content type';
  end if;
  update public.content_flags set status = case when p_hide then 'actioned' else 'dismissed' end
  where target_type = p_type and target_id = p_id and status = 'open';
  perform public.log_admin(case when p_hide then 'hide' else 'unhide' end, p_type, p_id::text, jsonb_build_object('reason', p_reason));
end;
$$;
revoke execute on function public.moderate(text, uuid, boolean, text) from public, anon;
grant execute on function public.moderate(text, uuid, boolean, text) to authenticated;

create or replace function public.admin_list_users(p_query text default null)
returns table (id uuid, display_name text, email text, role public.user_role, banned boolean, verified boolean,
  points integer, reports bigint, is_guest boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select p.id, p.display_name, u.email::text, p.role, p.banned, p.verified, p.points,
    (select count(*) from public.issues i where i.author_id = p.id), coalesce(u.is_anonymous, false), p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where p_query is null or p_query = ''
     or p.display_name ilike '%' || p_query || '%' or u.email ilike '%' || p_query || '%'
  order by p.created_at desc
  limit 50;
end;
$$;
revoke execute on function public.admin_list_users(text) from public, anon;
grant execute on function public.admin_list_users(text) to authenticated;

create or replace function public.admin_set_user(p_user uuid, p_role public.user_role default null, p_banned boolean default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_user = (select auth.uid()) then raise exception 'You cannot change your own role or ban yourself'; end if;
  if p_role is not null then
    update public.profiles set role = p_role where id = p_user;
    perform public.log_admin('set_role', 'profiles', p_user::text, jsonb_build_object('role', p_role));
  end if;
  if p_banned is not null then
    update public.profiles set banned = p_banned where id = p_user;
    perform public.log_admin(case when p_banned then 'ban' else 'unban' end, 'profiles', p_user::text, '{}'::jsonb);
  end if;
end;
$$;
revoke execute on function public.admin_set_user(uuid, public.user_role, boolean) from public, anon;
grant execute on function public.admin_set_user(uuid, public.user_role, boolean) to authenticated;

-- Log verification decisions too.
create or replace function public.verification_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.log_admin(new.status::text, 'verification', new.id::text, jsonb_build_object('user', new.user_id));
  end if;
  return new;
end;
$$;
revoke execute on function public.verification_audit() from public, anon, authenticated;
create trigger verification_audit_au after update on public.verification_requests for each row execute function public.verification_audit();

-- ---------------------------------------------------------------------------------------------
-- Canned staff replies
-- ---------------------------------------------------------------------------------------------
create table public.response_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 80),
  body text not null check (char_length(body) between 5 and 500),
  created_at timestamptz not null default now()
);
alter table public.response_templates enable row level security;
revoke all on public.response_templates from anon, authenticated;
grant select, insert, update, delete on public.response_templates to authenticated;
create policy "admins read templates" on public.response_templates for select to authenticated using ((select public.is_admin()));
create policy "admins write templates" on public.response_templates for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit templates" on public.response_templates for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete templates" on public.response_templates for delete to authenticated using ((select public.is_admin()));
create trigger templates_audit after insert or update or delete on public.response_templates for each row execute function public.audit_row();

insert into public.response_templates (title, body) values
  ('Received, inspecting', 'Thank you for reporting this. A field team has been asked to inspect the location. We will update this report after the visit.'),
  ('Passed to another agency', 'This falls under another department. We have forwarded it to them and will post their response here.'),
  ('Need more details', 'Thank you. Could you add a clearer photo or a nearby landmark so the team can find the exact spot?'),
  ('Work scheduled', 'Repair work has been scheduled. The promised fix date is shown at the top of this report.');

-- ---------------------------------------------------------------------------------------------
-- Editing and deleting your own content
-- ---------------------------------------------------------------------------------------------
create or replace function public.edit_my_issue(p_id uuid, p_title text, p_description text, p_location_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  it public.issues;
begin
  select * into it from public.issues where id = p_id for update;
  if it.id is null or it.author_id is distinct from (select auth.uid()) then raise exception 'You can only edit your own reports'; end if;
  if it.status <> 'pending' then raise exception 'Reports can only be edited before work starts'; end if;
  update public.issues set title = trim(p_title), description = trim(p_description), location_text = trim(p_location_text) where id = p_id;
  insert into public.issue_timeline (issue_id, status, title, note, actor_id) values (p_id, it.status, 'Edited by the reporter', '', (select auth.uid()));
end;
$$;
revoke execute on function public.edit_my_issue(uuid, text, text, text) from public, anon;
grant execute on function public.edit_my_issue(uuid, text, text, text) to authenticated;

create or replace function public.delete_my_issue(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  it public.issues;
begin
  select * into it from public.issues where id = p_id for update;
  if it.id is null or it.author_id is distinct from (select auth.uid()) then raise exception 'You can only delete your own reports'; end if;
  if it.status <> 'pending' then raise exception 'Reports can only be deleted before work starts. Ask an admin to close it instead.'; end if;
  delete from public.issues where id = p_id;
end;
$$;
revoke execute on function public.delete_my_issue(uuid) from public, anon;
grant execute on function public.delete_my_issue(uuid) to authenticated;

create or replace function public.edit_my_comment(p_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.comments;
begin
  select * into c from public.comments where id = p_id for update;
  if c.id is null or c.author_id is distinct from (select auth.uid()) then raise exception 'You can only edit your own comments'; end if;
  if c.created_at < now() - interval '15 minutes' then raise exception 'Comments can only be edited for 15 minutes'; end if;
  if char_length(trim(p_body)) not between 1 and 500 then raise exception 'Comments must be 1 to 500 characters'; end if;
  update public.comments set body = trim(p_body) where id = p_id;
end;
$$;
revoke execute on function public.edit_my_comment(uuid, text) from public, anon;
grant execute on function public.edit_my_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Data rights: export everything about me, and delete my account
-- ---------------------------------------------------------------------------------------------
create or replace function public.export_my_data()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = (select auth.uid())),
    'private_details', (select to_jsonb(pp) - 'id' from public.profile_private pp where pp.id = (select auth.uid())),
    'email', (select email from auth.users where id = (select auth.uid())),
    'reports', coalesce((select json_agg(json_build_object('ref', ref_no, 'title', title, 'description', description, 'category', category,
        'status', status, 'location', location_text, 'lat', lat, 'lng', lng, 'anonymous', anonymous, 'confidential', confidential, 'created_at', created_at))
      from public.issues where author_id = (select auth.uid())), '[]'::json),
    'reporter_contact_details', coalesce((select json_agg(json_build_object('name', name, 'email', email, 'phone', phone, 'created_at', created_at))
      from public.issue_reporter_contacts where user_id = (select auth.uid())), '[]'::json),
    'comments', coalesce((select json_agg(json_build_object('body', body, 'created_at', created_at)) from public.comments where author_id = (select auth.uid())), '[]'::json),
    'event_rsvps', coalesce((select json_agg(json_build_object('event', e.title, 'with_children', r.with_children, 'children_count', r.children_count))
      from public.event_rsvps r join public.events e on e.id = r.event_id where r.user_id = (select auth.uid())), '[]'::json),
    'emergency_contacts', coalesce((select json_agg(json_build_object('name', name, 'phone', phone)) from public.emergency_contacts where user_id = (select auth.uid())), '[]'::json),
    'points', coalesce((select json_agg(json_build_object('delta', delta, 'reason', reason, 'at', created_at)) from public.points_ledger where user_id = (select auth.uid())), '[]'::json),
    'verification_requests', coalesce((select json_agg(json_build_object('document', doc_type, 'status', status, 'created_at', created_at))
      from public.verification_requests where user_id = (select auth.uid())), '[]'::json)
  );
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- Reports stay as anonymous public records; everything personal is removed.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Not signed in'; end if;
  update public.issues set anonymous = true, public_author_id = null where author_id = me;
  delete from public.issue_reporter_contacts where user_id = me;
  delete from auth.users where id = me;
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
