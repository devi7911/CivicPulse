-- The department-routing Gemini call used an 8s HTTP timeout while the working photo-autofill call
-- (same model, same API, see 0046) uses 15s. LLM structured-output calls routinely take longer than
-- 8s, which is why this one was intermittently returning "AI service could not be reached (503)"
-- while the photo-autofill feature worked fine. Bring the timeout in line.
create or replace function public.admin_suggest_department(p_issue uuid, p_departments text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  it record;
  key text;
  hash text;
  today_count integer;
  resp extensions.http_response;
  body jsonb;
  raw text;
  parsed jsonb;
  dept text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(array_length(p_departments, 1), 0) = 0 then raise exception 'No department list was given.'; end if;

  select id, title, description into it from public.issues where id = p_issue;
  if it.id is null then raise exception 'That report no longer exists.'; end if;
  hash := md5(coalesce(it.title, '') || '|' || coalesce(it.description, ''));

  select ai_suggested_dept into dept from public.issues where id = p_issue and ai_suggested_hash = hash and ai_suggested_dept is not null;
  if dept is not null then
    return jsonb_build_object('ok', true, 'department', dept, 'cached', true);
  end if;

  key := private.gemini_key();
  if key is null or key = '' then
    raise exception 'No Gemini API key is set up. Ask whoever manages the database to add one (see the migration for the one-line SQL).';
  end if;

  select count(*) into today_count from public.admin_audit
  where action = 'ai_route_suggest' and created_at >= (now() at time zone 'Asia/Kolkata')::date;
  if today_count >= 200 then
    raise exception 'The daily limit for AI suggestions has been reached. Try again tomorrow, or set the department by hand.';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  resp := extensions.http((
    'POST', 'https://generativelanguage.googleapis.com/v1beta/models/' || private.gemini_model() || ':generateContent',
    array[extensions.http_header('x-goog-api-key', key)]::extensions.http_header[],
    'application/json',
    jsonb_build_object(
      'contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text',
        'You triage civic issue reports for a city government. Read the report and pick the single most ' ||
        'likely department to handle it from this exact list: ' || array_to_string(p_departments, ', ') || '. ' ||
        'If none clearly fits, answer "Other". Report title: ' || coalesce(it.title, '') ||
        '. Report description: ' || coalesce(it.description, '')
      )))),
      'generationConfig', jsonb_build_object(
        'responseMimeType', 'application/json',
        'responseSchema', jsonb_build_object(
          'type', 'OBJECT',
          'properties', jsonb_build_object(
            'department', jsonb_build_object('type', 'STRING', 'enum', to_jsonb(p_departments) || '["Other"]'::jsonb),
            'confidence', jsonb_build_object('type', 'STRING', 'enum', jsonb_build_array('low', 'medium', 'high')),
            'reason', jsonb_build_object('type', 'STRING')
          ),
          'required', jsonb_build_array('department', 'confidence', 'reason')
        )
      )
    )::text
  )::extensions.http_request);

  perform public.log_admin('ai_route_suggest', 'issues', p_issue::text, jsonb_build_object('title', it.title, 'ok', resp.status = 200));

  if resp.status <> 200 then
    return jsonb_build_object('ok', false, 'error', 'The AI service could not be reached right now (' || resp.status || ').');
  end if;

  begin
    body := resp.content::jsonb;
    raw := body #>> '{candidates,0,content,parts,0,text}';
    parsed := raw::jsonb;
    dept := parsed ->> 'department';
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The AI service gave an unreadable answer.');
  end;
  if dept is null or not (dept = any (p_departments) or dept = 'Other') then dept := 'Other'; end if;

  update public.issues set ai_suggested_dept = dept, ai_suggested_at = now(), ai_suggested_hash = hash where id = p_issue;

  return jsonb_build_object('ok', true, 'department', dept, 'confidence', coalesce(parsed ->> 'confidence', 'low'),
    'reason', left(coalesce(parsed ->> 'reason', ''), 200), 'cached', false);
end;
$$;
revoke all on function public.admin_suggest_department(uuid, text[]) from public, anon;
grant execute on function public.admin_suggest_department(uuid, text[]) to authenticated;
