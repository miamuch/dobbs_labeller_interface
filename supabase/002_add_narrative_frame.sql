alter table public.dobbs_labeling_labels
  add column if not exists narrative_frame text;

drop function if exists public.dobbs_export_labels(text, text);
drop function if exists public.dobbs_save_label(text, text, text, jsonb);
drop function if exists public.dobbs_get_my_labels(text, text);

create function public.dobbs_get_my_labels(p_access_code text, p_annotation_batch text default 'sub1000_new_tjst_fit_bert_workflow')
returns table (
  annotation_row_id text,
  annotation_batch text,
  human_stance text,
  human_stance_confidence text,
  narrative_frame text,
  stance_evidence_span text,
  stance_notes text,
  is_tjst_prior_correct text,
  is_side_reversal text,
  exclude_from_bert text,
  exclude_reason text,
  row_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_annotator_id uuid;
begin
  select ca.annotator_id into v_annotator_id
  from public.dobbs_current_annotator(p_access_code) ca;

  if v_annotator_id is null then
    raise exception 'Invalid access code';
  end if;

  return query
  select
    l.annotation_row_id,
    l.annotation_batch,
    l.human_stance,
    l.human_stance_confidence,
    l.narrative_frame,
    l.stance_evidence_span,
    l.stance_notes,
    l.is_tjst_prior_correct,
    l.is_side_reversal,
    l.exclude_from_bert,
    l.exclude_reason,
    l.row_status,
    l.updated_at
  from public.dobbs_labeling_labels l
  where l.annotator_id = v_annotator_id
    and l.annotation_batch = p_annotation_batch;
end;
$$;

create function public.dobbs_save_label(
  p_access_code text,
  p_annotation_row_id text,
  p_annotation_batch text,
  p_label jsonb
)
returns table (
  annotation_row_id text,
  annotation_batch text,
  row_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_annotator_id uuid;
begin
  select ca.annotator_id into v_annotator_id
  from public.dobbs_current_annotator(p_access_code) ca;

  if v_annotator_id is null then
    raise exception 'Invalid access code';
  end if;

  insert into public.dobbs_labeling_labels (
    annotation_row_id,
    annotation_batch,
    annotator_id,
    human_stance,
    human_stance_confidence,
    narrative_frame,
    stance_evidence_span,
    stance_notes,
    is_tjst_prior_correct,
    is_side_reversal,
    exclude_from_bert,
    exclude_reason,
    row_status,
    updated_at
  )
  values (
    p_annotation_row_id,
    coalesce(nullif(p_annotation_batch, ''), 'sub1000_new_tjst_fit_bert_workflow'),
    v_annotator_id,
    p_label ->> 'human_stance',
    p_label ->> 'human_stance_confidence',
    p_label ->> 'narrative_frame',
    p_label ->> 'stance_evidence_span',
    p_label ->> 'stance_notes',
    p_label ->> 'is_tjst_prior_correct',
    p_label ->> 'is_side_reversal',
    p_label ->> 'exclude_from_bert',
    p_label ->> 'exclude_reason',
    coalesce(nullif(p_label ->> 'row_status', ''), 'draft'),
    now()
  )
  on conflict on constraint dobbs_labeling_labels_pkey do update set
    annotation_batch = excluded.annotation_batch,
    human_stance = excluded.human_stance,
    human_stance_confidence = excluded.human_stance_confidence,
    narrative_frame = excluded.narrative_frame,
    stance_evidence_span = excluded.stance_evidence_span,
    stance_notes = excluded.stance_notes,
    is_tjst_prior_correct = excluded.is_tjst_prior_correct,
    is_side_reversal = excluded.is_side_reversal,
    exclude_from_bert = excluded.exclude_from_bert,
    exclude_reason = excluded.exclude_reason,
    row_status = excluded.row_status,
    updated_at = now();

  return query
  select l.annotation_row_id, l.annotation_batch, l.row_status, l.updated_at
  from public.dobbs_labeling_labels l
  where l.annotation_row_id = p_annotation_row_id
    and l.annotator_id = v_annotator_id;
end;
$$;

create function public.dobbs_export_labels(p_access_code text, p_annotation_batch text default 'sub1000_new_tjst_fit_bert_workflow')
returns table (
  annotation_row_id text,
  annotation_batch text,
  annotator_name text,
  human_stance text,
  human_stance_confidence text,
  narrative_frame text,
  stance_evidence_span text,
  stance_notes text,
  is_tjst_prior_correct text,
  is_side_reversal text,
  exclude_from_bert text,
  exclude_reason text,
  row_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_annotator_id uuid;
  v_role text;
begin
  select ca.annotator_id, ca.annotator_role into v_annotator_id, v_role
  from public.dobbs_current_annotator(p_access_code) ca;

  if v_annotator_id is null then
    raise exception 'Invalid access code';
  end if;

  return query
  select
    l.annotation_row_id,
    l.annotation_batch,
    a.display_name as annotator_name,
    l.human_stance,
    l.human_stance_confidence,
    l.narrative_frame,
    l.stance_evidence_span,
    l.stance_notes,
    l.is_tjst_prior_correct,
    l.is_side_reversal,
    l.exclude_from_bert,
    l.exclude_reason,
    l.row_status,
    l.updated_at
  from public.dobbs_labeling_labels l
  join public.dobbs_labeling_annotators a on a.id = l.annotator_id
  where l.annotation_batch = p_annotation_batch
    and (v_role = 'admin' or l.annotator_id = v_annotator_id)
  order by l.annotation_row_id, a.display_name;
end;
$$;

revoke all on function public.dobbs_get_my_labels(text, text) from public;
revoke all on function public.dobbs_save_label(text, text, text, jsonb) from public;
revoke all on function public.dobbs_export_labels(text, text) from public;

revoke all on function public.dobbs_get_my_labels(text, text) from authenticated;
revoke all on function public.dobbs_save_label(text, text, text, jsonb) from authenticated;
revoke all on function public.dobbs_export_labels(text, text) from authenticated;

grant execute on function public.dobbs_get_my_labels(text, text) to anon;
grant execute on function public.dobbs_save_label(text, text, text, jsonb) to anon;
grant execute on function public.dobbs_export_labels(text, text) to anon;

notify pgrst, 'reload schema';
