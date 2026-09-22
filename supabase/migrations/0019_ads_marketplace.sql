-- Self-serve ads marketplace (like an Ads Manager, without personal tracking).
-- Advertisers (NGOs, local businesses) create campaigns; admins review and confirm payment; the feed
-- serves ads by budget-weighted rotation, optionally matched to the category being viewed (context,
-- never the person). Views and clicks are counted anonymously per day, once per network per day.

create table public.advertisers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  kind text not null default 'business' check (kind in ('ngo', 'business', 'government')),
  website text check (website is null or website ~ '^https://'),
  contact_email text not null check (contact_email ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.advertisers enable row level security;
revoke all on public.advertisers from anon, authenticated;
grant select on public.advertisers to authenticated;
grant insert (owner_id, name, kind, website, contact_email) on public.advertisers to authenticated;
grant update (name, kind, website, contact_email) on public.advertisers to authenticated;
create policy "own advertiser or admin" on public.advertisers for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "create own advertiser" on public.advertisers for insert to authenticated
  with check (owner_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) and not (select public.is_banned()));
create policy "edit own advertiser" on public.advertisers for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 90),
  body text not null check (char_length(body) between 10 and 200),
  cta_label text not null default 'Learn more' check (cta_label in ('Donate', 'Learn more', 'Visit', 'Shop now', 'Sign up', 'Register')),
  cta_url text not null check (cta_url ~ '^https://' and char_length(cta_url) <= 500),
  media_path text,
  media_type text check (media_type is null or media_type in ('image', 'gif', 'video')),
  target_category public.issue_category,
  target_area text check (target_area is null or char_length(target_area) <= 60),
  budget_inr integer not null check (budget_inr between 500 and 500000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'paused', 'ended')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  paid boolean not null default false,
  payment_ref text check (payment_ref is null or char_length(payment_ref) <= 80),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on public.ad_campaigns (status, starts_at, ends_at);
create index on public.ad_campaigns (advertiser_id);
alter table public.ad_campaigns enable row level security;
revoke all on public.ad_campaigns from anon, authenticated;
grant select, delete on public.ad_campaigns to authenticated;
grant insert (advertiser_id, title, body, cta_label, cta_url, media_path, media_type, target_category, target_area, budget_inr, starts_at, ends_at)
  on public.ad_campaigns to authenticated;
grant update (title, body, cta_label, cta_url, media_path, media_type, target_category, target_area, budget_inr, starts_at, ends_at)
  on public.ad_campaigns to authenticated;

create or replace function public.owns_advertiser(p_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.advertisers where id = p_id and owner_id = (select auth.uid())) $$;
grant execute on function public.owns_advertiser(uuid) to authenticated;

create policy "own campaigns or admin" on public.ad_campaigns for select to authenticated
  using (public.owns_advertiser(advertiser_id) or (select public.is_admin()));
create policy "create own campaign" on public.ad_campaigns for insert to authenticated
  with check (public.owns_advertiser(advertiser_id) and not (select public.is_banned()));
-- Advertisers may edit drafts and rejected campaigns only; edits send it back to draft.
create policy "edit own draft" on public.ad_campaigns for update to authenticated
  using (public.owns_advertiser(advertiser_id) and status in ('draft', 'rejected'))
  with check (public.owns_advertiser(advertiser_id));
create policy "delete own unpaid" on public.ad_campaigns for delete to authenticated
  using (public.owns_advertiser(advertiser_id) and not paid);

-- Ad media: advertisers upload into their own folder of the public ads bucket.
create policy "advertisers upload own ad media" on storage.objects for insert to authenticated
  with check (bucket_id = 'ads' and (storage.foldername(name))[1] = (select auth.uid())::text
    and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "advertisers delete own ad media" on storage.objects for delete to authenticated
  using (bucket_id = 'ads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Anonymous daily counters. No user ids; the per-network de-duplication uses salted hashes and is
-- kept for one day only.
create table public.ad_daily_stats (
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  day date not null,
  views integer not null default 0,
  clicks integer not null default 0,
  primary key (campaign_id, day)
);
alter table public.ad_daily_stats enable row level security;
revoke all on public.ad_daily_stats from anon, authenticated;
grant select on public.ad_daily_stats to authenticated;
create policy "own stats or admin" on public.ad_daily_stats for select to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.ad_campaigns c where c.id = campaign_id and public.owns_advertiser(c.advertiser_id)));

create table private.ad_seen (
  campaign_id uuid not null,
  kind text not null,
  day date not null,
  who text not null,
  primary key (campaign_id, kind, day, who)
);

-- Flat pricing: Rs 100 per 1,000 views.
create or replace function public.ad_spent_inr(p_campaign uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$ select round(coalesce(sum(views), 0) * 0.1, 2) from public.ad_daily_stats where campaign_id = p_campaign $$;
grant execute on function public.ad_spent_inr(uuid) to authenticated;

-- Which ads to show. Contextual only: an optional category the viewer is browsing.
create or replace function public.serve_ads(p_category public.issue_category default null, p_limit integer default 3)
returns table (id uuid, title text, body text, cta_label text, cta_url text, media_path text, media_type text, advertiser text, advertiser_website text, verified boolean)
language sql volatile security definer set search_path = ''
as $$
  select c.id, c.title, c.body, c.cta_label, c.cta_url, c.media_path, c.media_type, a.name, a.website, a.verified
  from public.ad_campaigns c
  join public.advertisers a on a.id = c.advertiser_id
  join public.profiles p on p.id = a.owner_id
  where c.status = 'approved' and c.paid and not p.banned
    and now() between c.starts_at and c.ends_at
    and public.ad_spent_inr(c.id) < c.budget_inr
    and (c.target_category is null or p_category is null or c.target_category = p_category)
  order by (case when p_category is not null and c.target_category = p_category then 1 else 0 end) desc,
    random() * greatest(c.budget_inr - public.ad_spent_inr(c.id), 1) desc
  limit least(greatest(coalesce(p_limit, 3), 1), 5);
$$;
grant execute on function public.serve_ads(public.issue_category, integer) to anon, authenticated;

create or replace function public.record_ad_event(p_campaign uuid, p_kind text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  who text := coalesce(private.hash_signal(private.request_ip()), 'unknown');
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_kind not in ('view', 'click') then return; end if;
  if not exists (select 1 from public.ad_campaigns where id = p_campaign and status = 'approved' and paid) then return; end if;
  insert into private.ad_seen (campaign_id, kind, day, who) values (p_campaign, p_kind, today, who) on conflict do nothing;
  if not found then return; end if;
  insert into public.ad_daily_stats (campaign_id, day, views, clicks)
  values (p_campaign, today, (p_kind = 'view')::int, (p_kind = 'click')::int)
  on conflict (campaign_id, day) do update set
    views = public.ad_daily_stats.views + excluded.views,
    clicks = public.ad_daily_stats.clicks + excluded.clicks;
end;
$$;
grant execute on function public.record_ad_event(uuid, text) to anon, authenticated;

-- Advertiser actions: submit for review, pause, resume.
create or replace function public.set_campaign_state(p_id uuid, p_action text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.ad_campaigns;
begin
  select * into c from public.ad_campaigns where id = p_id for update;
  if c.id is null or not public.owns_advertiser(c.advertiser_id) then raise exception 'Not your campaign'; end if;
  if p_action = 'submit' and c.status in ('draft', 'rejected') then
    update public.ad_campaigns set status = 'pending', review_note = null where id = p_id;
    insert into public.notifications (user_id, kind, title, body)
    select id, 'ads', left('Ad to review: ' || c.title, 140), 'Budget Rs ' || c.budget_inr from public.profiles where role = 'admin';
  elsif p_action = 'pause' and c.status = 'approved' then
    update public.ad_campaigns set status = 'paused' where id = p_id;
  elsif p_action = 'resume' and c.status = 'paused' then
    update public.ad_campaigns set status = 'approved' where id = p_id;
  else
    raise exception 'That action is not possible for a % campaign', c.status;
  end if;
end;
$$;
revoke execute on function public.set_campaign_state(uuid, text) from public, anon;
grant execute on function public.set_campaign_state(uuid, text) to authenticated;

-- Admin review.
create or replace function public.review_campaign(p_id uuid, p_approve boolean, p_note text default null, p_paid boolean default null, p_payment_ref text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.ad_campaigns;
  owner uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into c from public.ad_campaigns where id = p_id for update;
  if c.id is null then raise exception 'Campaign not found'; end if;
  if not p_approve and char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Give the advertiser a reason'; end if;
  update public.ad_campaigns set
    status = case when p_approve then 'approved' else 'rejected' end,
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    paid = coalesce(p_paid, paid),
    payment_ref = coalesce(nullif(trim(coalesce(p_payment_ref, '')), ''), payment_ref)
  where id = p_id;
  select owner_id into owner from public.advertisers where id = c.advertiser_id;
  insert into public.notifications (user_id, kind, title, body)
  values (owner, 'ads', left(case when p_approve then 'Ad approved: ' else 'Ad needs changes: ' end || c.title, 140),
    left(coalesce(p_note, case when p_approve then 'Your ad will run once payment is confirmed and the start date arrives.' else '' end), 300));
  perform public.log_admin(case when p_approve then 'approve_ad' else 'reject_ad' end, 'ad_campaigns', p_id::text,
    jsonb_build_object('title', c.title, 'paid', coalesce(p_paid, c.paid)));
end;
$$;
revoke execute on function public.review_campaign(uuid, boolean, text, boolean, text) from public, anon;
grant execute on function public.review_campaign(uuid, boolean, text, boolean, text) to authenticated;

create or replace function public.verify_advertiser(p_id uuid, p_verified boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.advertisers set verified = p_verified where id = p_id;
  perform public.log_admin(case when p_verified then 'verify_advertiser' else 'unverify_advertiser' end, 'advertisers', p_id::text, '{}'::jsonb);
end;
$$;
revoke execute on function public.verify_advertiser(uuid, boolean) from public, anon;
grant execute on function public.verify_advertiser(uuid, boolean) to authenticated;

-- Editing an approved or pending campaign is not allowed; editing a rejected one returns it to draft.
create or replace function public.ad_campaigns_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_admin() or current_setting('civicpulse.internal', true) = 'on' then return new; end if;
  if old.status = 'rejected' then new.status := 'draft'; end if;
  return new;
end;
$$;
revoke execute on function public.ad_campaigns_before_update() from public, anon, authenticated;
create trigger ad_campaigns_bu before update on public.ad_campaigns for each row execute function public.ad_campaigns_before_update();

-- New campaigns always start as unpaid drafts, whatever the client sends.
create or replace function public.ad_campaigns_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.status := 'draft'; new.paid := false; new.payment_ref := null; new.review_note := null; new.created_at := now();
  if (select count(*) from public.ad_campaigns where advertiser_id = new.advertiser_id and status in ('draft', 'pending')) >= 10 then
    raise exception 'You have 10 unfinished campaigns. Submit or delete some first.';
  end if;
  return new;
end;
$$;
revoke execute on function public.ad_campaigns_before_insert() from public, anon, authenticated;
create trigger ad_campaigns_bi before insert on public.ad_campaigns for each row execute function public.ad_campaigns_before_insert();

-- Old de-duplication rows are not needed after the day ends.
create or replace function private.purge_old_data()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.issue_reporter_contacts where created_at < now() - interval '12 months';
  delete from public.client_errors where created_at < now() - interval '30 days';
  delete from public.notifications where created_at < now() - interval '6 months';
  delete from private.ad_seen where day < (now() at time zone 'Asia/Kolkata')::date - 1;
$$;
