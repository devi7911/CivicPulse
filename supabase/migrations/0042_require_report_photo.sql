-- Every report must have a photo. Enforced server-side (not just in the form), and a report's photo
-- can never be cleared once set. Two of the three existing photo-less test reports are backfilled
-- with the matching sample image already shipped in web/public/samples; the third (a "stray dogs"
-- report, category "other") has no matching sample and is left for a real photo or manual fix.

update public.issues set photo_path = 'samples/pothole.jpg' where ref_no = 'CP-26-000007' and photo_path is null;
update public.issues set photo_path = 'samples/lights.jpg' where ref_no = 'CP-26-000050' and photo_path is null;

create or replace function public.issues_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  txt text := lower(new.title || ' ' || new.description);
  score integer;
  kw text;
  today_count integer;
begin
  if coalesce(trim(new.photo_path), '') = '' then
    raise exception 'Please add at least one photo of the problem.';
  end if;

  select count(*) into today_count from public.issues
  where author_id = new.author_id and created_at >= now() - interval '1 day';
  if today_count >= 10 then
    raise exception 'Daily report limit reached. Please try again tomorrow.';
  end if;

  score := case new.category
    when 'water' then 50 when 'roads' then 40 when 'waste' then 30
    when 'lighting' then 25 else 20 end;
  foreach kw in array array['danger','hazard','risk','accident','harm','collapse','injury','toxic','poison'] loop
    if position(kw in txt) > 0 then score := score + 10; end if;
  end loop;
  foreach kw in array array['urgent','emergency','immediate','leak','flood','burst','electric shock','exposed wire'] loop
    if position(kw in txt) > 0 then score := score + 8; end if;
  end loop;
  foreach kw in array array['child','kids','elderly','school','hospital','baby'] loop
    if position(kw in txt) > 0 then score := score + 5; end if;
  end loop;
  score := least(100, score);

  new.ref_no := 'CP-' || to_char(now() at time zone 'Asia/Kolkata', 'YY') || '-'
    || lpad(nextval('public.issue_ref_seq')::text, 6, '0');
  new.public_author_id := case when new.anonymous then null else new.author_id end;
  new.priority_score := score;
  new.severity := (case when score >= 70 then 'high' when score >= 40 then 'medium' else 'low' end)::public.severity;
  new.status := 'pending';
  new.assignee := null;
  new.resolved_photo_path := null;
  new.target_date := null;
  new.closed_reason := null;
  new.closed_note := null;
  new.resolved_at := null;
  new.verdict := null;
  new.verdict_at := null;
  new.reopen_count := 0;
  new.upvote_count := 0;
  new.comment_count := 0;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- A report's photo can never be cleared once set (defensive; nothing currently tries to).
create or replace function public.issues_keep_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is null and old.photo_path is not null then
    new.photo_path := old.photo_path;
  end if;
  return new;
end;
$$;
drop trigger if exists issues_0_keep_photo on public.issues;
create trigger issues_0_keep_photo before update on public.issues for each row execute function public.issues_keep_photo();

-- Enforced for every future row without needing every existing row fixed first; the one
-- remaining photo-less report (CP-26-000048) keeps this from validating until it is fixed too.
alter table public.issues drop constraint if exists issues_photo_required;
alter table public.issues add constraint issues_photo_required check (photo_path is not null) not valid;
