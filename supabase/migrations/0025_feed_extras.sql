-- Feed extras: locality ("area") on reports for the area filter, short video clips on reports,
-- category counts for the filter circles, and the list of areas that have reports.

-- Locality/neighbourhood name (e.g. "Madhapur"), filled by the app from the pin via reverse geocoding.
alter table public.issues add column area text check (area is null or char_length(area) between 2 and 60);
create index on public.issues (area);
grant select (area) on public.issues to anon, authenticated;
grant insert (area) on public.issues to authenticated;

-- Short video clips (up to 25 MB, checked for 30 seconds in the app), stored in each uploader's folder.
alter table public.issues add column video_path text check (video_path is null or char_length(video_path) <= 300);
grant select (video_path) on public.issues to anon, authenticated;
grant insert (video_path) on public.issues to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 26214400, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
create policy "upload own report video" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.is_banned()));
create policy "delete own report video or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));

-- Areas that have public reports, with how many are open (for the area filter).
create or replace function public.report_areas()
returns table (area text, total bigint, open bigint)
language sql stable security definer set search_path = ''
as $$
  select i.area, count(*), count(*) filter (where i.status in ('pending', 'progress'))
  from public.issues i where i.area is not null and not i.confidential and not i.hidden
  group by i.area order by count(*) desc, i.area limit 60;
$$;
grant execute on function public.report_areas() to anon, authenticated;

-- Open report counts per category for the filter circles.
create or replace function public.category_counts()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_object_agg(category, n), '{}'::json) from (
    select category, count(*) n from public.issues
    where not confidential and not hidden and status in ('pending', 'progress') group by category) c;
$$;
grant execute on function public.category_counts() to anon, authenticated;
