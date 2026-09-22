-- Verification by manual ID review, plus the official payment portal links.
-- Aadhaar is deliberately not an accepted document type. The uploaded file lives in a private
-- bucket and is deleted as soon as an admin decides; only "verified, how, when" is kept.

create type public.verification_status as enum ('pending', 'approved', 'rejected');

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  doc_type text not null check (doc_type in ('driving_licence', 'voter_id', 'passport', 'pan_card', 'other_govt_id')),
  doc_path text,
  status public.verification_status not null default 'pending',
  note text check (note is null or char_length(note) <= 300),
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index on public.verification_requests (user_id, created_at desc);
create index on public.verification_requests (status, created_at);
create index on public.verification_requests (reviewed_by);
create unique index one_pending_request_per_user on public.verification_requests (user_id) where status = 'pending';

create or replace function public.verification_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
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
revoke execute on function public.verification_before_insert() from public, anon, authenticated;
create trigger verification_bi before insert on public.verification_requests
  for each row execute function public.verification_before_insert();

-- Admin decision. Returns the document path so the admin's app can delete the file straight away.
create or replace function public.review_verification(p_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  req public.verification_requests;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  select * into req from public.verification_requests where id = p_id for update;
  if req.id is null then raise exception 'Request not found'; end if;
  if req.status <> 'pending' then raise exception 'This request was already reviewed'; end if;

  update public.verification_requests
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.verification_status,
      note = left(p_note, 300), reviewed_by = (select auth.uid()), reviewed_at = now(), doc_path = null
  where id = p_id;

  if p_approve then
    update public.profiles set verified = true where id = req.user_id;
    update public.profile_private
    set verified_method = 'manual_id_review:' || req.doc_type, verified_at = now(), updated_at = now()
    where id = req.user_id;
    perform public.award_points(req.user_id, 40, 'Completed verification');
  end if;
  return req.doc_path;
end;
$$;
revoke execute on function public.review_verification(uuid, boolean, text) from public, anon;
grant execute on function public.review_verification(uuid, boolean, text) to authenticated;

alter table public.verification_requests enable row level security;
revoke all on public.verification_requests from anon, authenticated;
grant select on public.verification_requests to authenticated;
grant insert (user_id, doc_type, doc_path) on public.verification_requests to authenticated;

create policy "read own requests or admin" on public.verification_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "request as self" on public.verification_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-docs', 'id-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload own id doc" on storage.objects for insert to authenticated
  with check (bucket_id = 'id-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "read own id doc or admin" on storage.objects for select to authenticated
  using (bucket_id = 'id-docs' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
create policy "delete own id doc or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'id-docs' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));

-- Official portals. Each was checked to resolve on 2026-09-19; review before launch.
insert into public.utility_links (category, title, description, url, sort) values
  ('electricity', 'TGSPDCL bill payment', 'Southern Power Distribution Company of Telangana', 'https://tgsouthernpower.org/', 1),
  ('challan', 'Telangana e-Challan', 'Check and pay pending traffic challans', 'https://echallan.tspolice.gov.in/publicview/', 2),
  ('water', 'HMWSSB water bill', 'Hyderabad Metropolitan Water Supply and Sewerage Board', 'https://www.hyderabadwater.gov.in/', 3),
  ('property_tax', 'GHMC property tax', 'Greater Hyderabad Municipal Corporation online payments', 'https://onlinepayments.ghmc.gov.in/', 4),
  ('other', 'GHMC citizen services', 'Trade licence, birth and death certificates, grievances', 'https://ghmc.gov.in/', 5);
