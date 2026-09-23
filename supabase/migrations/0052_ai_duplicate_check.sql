-- AI duplicate-report assist: when a citizen is drafting a report and there are several open
-- reports nearby (same category, within 250m — see nearby_open_issues), it's tedious to read each
-- one to see which, if any, is the same problem. This ranks the candidates the client already has
-- (public data only: id + title) against the draft's own title/description, and returns the single
-- best match if there is one — a soft nudge, not a block. The real duplicate guard stays the hard,
-- geo-based server check in issues_dedupe() (0035); this never blocks or auto-merges anything.
create or replace function public.rank_similar_reports(p_title text, p_description text, p_candidates jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  key text;
  user_count integer;
  global_count integer;
  since timestamptz := (now() at time zone 'Asia/Kolkata')::date;
  resp extensions.http_response;
  body jsonb;
  raw text;
  parsed jsonb;
  n_candidates integer := jsonb_array_length(coalesce(p_candidates, '[]'::jsonb));
  ids text[];
begin
  if me is null then raise exception 'Please try again in a moment.'; end if;
  if public.is_banned() then raise exception 'Your account cannot use this right now.'; end if;
  if n_candidates < 1 then return jsonb_build_object('ok', true, 'match_id', null); end if;
  if n_candidates > 10 then raise exception 'Too many candidates.'; end if;
  if char_length(coalesce(p_title, '')) = 0 then raise exception 'A title is required.'; end if;

  select array_agg(value ->> 'id') into ids from jsonb_array_elements(p_candidates);
  if exists (select 1 from unnest(ids) x where x !~ '^[0-9a-f-]{36}$') then raise exception 'Invalid candidate id.'; end if;

  select count(*) into user_count from public.ai_usage_log where kind = 'duplicate_check' and user_id = me and created_at >= since;
  if user_count >= 8 then
    raise exception 'You have used this check 8 times today. Please compare the nearby reports yourself.';
  end if;
  select count(*) into global_count from public.ai_usage_log where kind = 'duplicate_check' and created_at >= since;
  if global_count >= 150 then
    raise exception 'This check is fully booked for today. Please compare the nearby reports yourself.';
  end if;

  key := private.gemini_key();
  if key is null or key = '' then raise exception 'This check is not set up yet.'; end if;

  insert into public.ai_usage_log (user_id, kind) values (me, 'duplicate_check');

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  resp := extensions.http((
    'POST', 'https://generativelanguage.googleapis.com/v1beta/models/' || private.gemini_model() || ':generateContent',
    array[extensions.http_header('x-goog-api-key', key)]::extensions.http_header[],
    'application/json',
    jsonb_build_object(
      'contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text',
        'A citizen is about to report a civic problem (pothole, garbage, streetlight, water leak, etc.) that is near some ' ||
        'reports already open nearby. Decide whether any EXISTING report describes the exact same problem (not just the same ' ||
        'street or category — the same specific issue). If none clearly match, say so. ' ||
        'New report title: "' || p_title || '". New report description: "' || coalesce(p_description, '') || '". ' ||
        'Existing nearby reports (id and title only), as JSON: ' || p_candidates::text
      )))),
      'generationConfig', jsonb_build_object(
        'responseMimeType', 'application/json',
        'responseSchema', jsonb_build_object(
          'type', 'OBJECT',
          'properties', jsonb_build_object(
            'match_id', jsonb_build_object('type', 'STRING', 'enum', to_jsonb(ids) || '["none"]'::jsonb),
            'confidence', jsonb_build_object('type', 'STRING', 'enum', jsonb_build_array('low', 'medium', 'high')),
            'reason', jsonb_build_object('type', 'STRING')
          ),
          'required', jsonb_build_array('match_id', 'confidence', 'reason')
        )
      )
    )::text
  )::extensions.http_request);

  if resp.status <> 200 then
    return jsonb_build_object('ok', false, 'error', 'The AI check could not be reached right now (' || resp.status || ').');
  end if;

  begin
    body := resp.content::jsonb;
    raw := body #>> '{candidates,0,content,parts,0,text}';
    parsed := raw::jsonb;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The AI check gave an unreadable answer.');
  end;

  if (parsed ->> 'match_id') = 'none' or not (parsed ->> 'match_id' = any (ids)) then
    return jsonb_build_object('ok', true, 'match_id', null);
  end if;

  return jsonb_build_object('ok', true, 'match_id', parsed ->> 'match_id', 'confidence', parsed ->> 'confidence', 'reason', left(coalesce(parsed ->> 'reason', ''), 200));
end;
$$;
revoke all on function public.rank_similar_reports(text, text, jsonb) from public, anon;
grant execute on function public.rank_similar_reports(text, text, jsonb) to authenticated;
