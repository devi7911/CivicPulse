-- Admins reply to citizens as staff, often several times on one report, so the anti-spam
-- comment limits (3 per report, 30 per day) apply to everyone except admins.
create or replace function public.comments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  on_post integer;
  today integer;
begin
  if not public.is_admin() then
    select count(*) into on_post from public.comments
    where issue_id = new.issue_id and author_id = new.author_id;
    if on_post >= 3 then
      raise exception 'Comment limit reached: 3 comments per post';
    end if;
    select count(*) into today from public.comments
    where author_id = new.author_id and created_at >= now() - interval '1 day';
    if today >= 30 then
      raise exception 'Daily comment limit reached';
    end if;
  end if;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;

-- Staff replies are labelled as such in the reporter's and followers' notifications.
create or replace function public.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  who text;
  staff boolean := public.is_admin();
begin
  select title, ref_no into it from public.issues where id = new.issue_id;
  select display_name into who from public.profiles where id = new.author_id;
  perform public.notify_issue(new.issue_id, 'comment',
    case when staff then 'Staff reply · ' else 'New comment · ' end || it.ref_no,
    case when staff then 'CivicPulse staff' else coalesce(who, 'Someone') end || ': ' || new.body, new.author_id);
  return new;
end;
$$;
