-- Data retention promised in the privacy policy, and a small client error log for monitoring.

create extension if not exists pg_cron;

-- Guest contact details are only needed while a report is being handled.
create or replace function private.purge_old_data()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.issue_reporter_contacts where created_at < now() - interval '12 months';
  delete from public.client_errors where created_at < now() - interval '30 days';
  delete from public.notifications where created_at < now() - interval '6 months';
$$;

-- ---------------------------------------------------------------------------------------------
-- Client error log: the app reports crashes here (no personal data, size limited).
-- ---------------------------------------------------------------------------------------------
create table public.client_errors (
  id bigint generated always as identity primary key,
  message text not null check (char_length(message) <= 500),
  stack text check (stack is null or char_length(stack) <= 4000),
  path text check (path is null or char_length(path) <= 200),
  release text check (release is null or char_length(release) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant insert (message, stack, path, release, user_agent) on public.client_errors to anon, authenticated;
grant select on public.client_errors to authenticated;
create policy "anyone can report an error" on public.client_errors for insert to anon, authenticated with check (true);
create policy "admins read errors" on public.client_errors for select to authenticated using ((select public.is_admin()));

-- Stop a single broken client from flooding the table: at most 500 errors per 10 minutes overall.
create or replace function public.client_errors_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.client_errors where created_at > now() - interval '10 minutes') >= 500 then
    return null; -- silently drop
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke execute on function public.client_errors_limit() from public, anon, authenticated;
create trigger client_errors_bi before insert on public.client_errors for each row execute function public.client_errors_limit();

select cron.schedule('civicpulse-purge', '17 3 * * *', 'select private.purge_old_data()');
