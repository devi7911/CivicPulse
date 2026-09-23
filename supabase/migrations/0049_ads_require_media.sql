-- Every ad and sponsored post must carry a picture (or GIF/video), same principle as reports.
-- Campaigns can still be saved as an incomplete draft without media, but cannot be submitted for
-- review without one. Sponsored posts have no draft step, so it is required at creation.

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
    if c.media_path is null then raise exception 'Add a photo, GIF or video before submitting your ad for review.'; end if;
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

create or replace function public.sponsored_posts_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.media_path is null then raise exception 'Add a photo, GIF or video for this sponsored post.'; end if;
  return new;
end;
$$;
revoke execute on function public.sponsored_posts_before_insert() from public, anon, authenticated;
create trigger sponsored_posts_bi before insert on public.sponsored_posts
  for each row execute function public.sponsored_posts_before_insert();
