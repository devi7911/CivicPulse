-- Covering indexes for foreign keys the linter flagged. Harmless now, avoids slow lookups/joins
-- and locked-table scans on delete as these tables grow.
create index if not exists child_alerts_created_by_idx on public.child_alerts (created_by);
create index if not exists city_alerts_created_by_idx on public.city_alerts (created_by);
create index if not exists contribution_applause_user_id_idx on public.contribution_applause (user_id);
create index if not exists contributions_event_id_idx on public.contributions (event_id);
create index if not exists contributions_issue_id_idx on public.contributions (issue_id);
create index if not exists issue_claims_admin_id_idx on public.issue_claims (admin_id);
create index if not exists issues_duplicate_of_idx on public.issues (duplicate_of);
create index if not exists support_messages_author_id_idx on public.support_messages (author_id);
