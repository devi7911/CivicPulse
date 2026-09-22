-- Sponsored posts can carry a looping GIF or a short video so they read as an advertisement.
alter table public.sponsored_posts
  add column media_path text check (media_path is null or char_length(media_path) <= 300),
  add column media_type text check (media_type is null or media_type in ('image', 'gif', 'video')),
  add constraint sponsored_media_pair check ((media_path is null) = (media_type is null));

-- Ad media is hosted by CivicPulse itself, never hot-linked, so advertisers cannot track viewers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ads', 'ads', true, 8388608, array['image/gif', 'image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

create policy "admins upload ad media" on storage.objects for insert to authenticated
  with check (bucket_id = 'ads' and (select public.is_admin()));
create policy "admins delete ad media" on storage.objects for delete to authenticated
  using (bucket_id = 'ads' and (select public.is_admin()));

-- Sample content only: the bundled looping animation.
update public.sponsored_posts set media_path = 'samples/ad-saplings.svg', media_type = 'gif'
where title like 'Help us plant 1,000 saplings%';
