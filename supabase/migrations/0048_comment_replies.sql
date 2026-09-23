-- Nested replies on report comments. Kept to 2 levels (top-level comments + a flat list of
-- replies under each) rather than arbitrary depth: a reply to a reply is attached to the same
-- top-level parent, which is what the UI renders and is simpler to reason about than a real tree.
alter table public.comments add column parent_id uuid references public.comments (id) on delete cascade;
create index on public.comments (parent_id);

grant insert (parent_id) on public.comments to authenticated;

create or replace function public.comments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  on_post integer;
  today integer;
  parent record;
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
  if new.parent_id is not null then
    select id, issue_id, parent_id into parent from public.comments where id = new.parent_id;
    if parent is null then raise exception 'That comment no longer exists.'; end if;
    if parent.issue_id <> new.issue_id then raise exception 'Cannot reply across reports.'; end if;
    -- Flatten reply-to-a-reply onto the original top-level comment.
    if parent.parent_id is not null then new.parent_id := parent.parent_id; end if;
  end if;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;
