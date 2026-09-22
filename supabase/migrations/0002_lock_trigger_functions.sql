-- Trigger functions are internal. Nobody should be able to call them through the API.
-- is_admin() stays callable because row-level security policies run it as the signed-in user.
revoke execute on function
  public.comments_after_change(), public.comments_before_insert(),
  public.emergency_contacts_before_insert(), public.issues_after_insert(),
  public.issues_before_insert(), public.issues_before_update(),
  public.rsvps_after_change(), public.rsvps_before_insert(),
  public.upvotes_after_change(), public.guard_profile_update()
from public, anon, authenticated;
