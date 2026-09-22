-- ad_spent_inr had no ownership or admin check: anyone who learned a campaign id (these already
-- travel to the browser via record_ad_event when a sponsored post is shown) could look up any
-- advertiser's spend. Nothing in the app calls this function today, but it was still reachable
-- over the API with no gate at all. Restricting it to the campaign's owner or an admin.
create or replace function public.ad_spent_inr(p_campaign uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(coalesce(sum(s.views), 0) * 0.1, 2)
  from public.ad_daily_stats s
  join public.ad_campaigns c on c.id = s.campaign_id
  where s.campaign_id = p_campaign and (public.owns_advertiser(c.advertiser_id) or public.is_admin());
$$;
