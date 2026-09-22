-- "Closed without a fix" (private land, another agency, no budget...). Separate migration because a
-- new enum value cannot be used in the same transaction that adds it.
alter type public.issue_status add value if not exists 'closed';
