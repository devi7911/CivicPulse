-- Every sighting must include who is reporting, a phone number the police can call back, where,
-- when and what was seen. (The table was empty when this was applied.)
alter table public.child_alert_sightings
  add column reporter_name text check (reporter_name is null or char_length(trim(reporter_name)) between 2 and 60);

delete from public.child_alert_sightings where note is null or contact_phone is null;

alter table public.child_alert_sightings
  alter column reporter_name set not null,
  alter column note set not null,
  alter column contact_phone set not null,
  drop constraint if exists child_alert_sightings_note_check,
  add constraint child_alert_sightings_note_check check (char_length(trim(note)) between 5 and 500);

grant insert (reporter_name) on public.child_alert_sightings to anon, authenticated;
