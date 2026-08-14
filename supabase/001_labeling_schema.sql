create extension if not exists pgcrypto;

create table if not exists public.dobbs_labeling_annotators (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  role text not null default 'ra' check (role in ('admin', 'ra')),
  access_code_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.dobbs_labeling_labels (
  annotation_row_id text not null,
  annotation_batch text not null default 'sub1000_new_tjst_fit_bert_workflow',
  annotator_id uuid not null references public.dobbs_labeling_annotators(id),
  human_stance text,
  human_stance_confidence text,
  stance_evidence_span text,
  stance_notes text,
  is_tjst_prior_correct text,
  is_side_reversal text,
  exclude_from_bert text,
  exclude_reason text,
  row_status text not null default 'draft' check (row_status in ('draft', 'complete')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (annotation_row_id, annotator_id)
);

alter table public.dobbs_labeling_annotators enable row level security;
alter table public.dobbs_labeling_labels enable row level security;

-- Create annotators manually with private access codes, for example:
-- insert into public.dobbs_labeling_annotators (display_name, role, access_code_hash)
-- values ('RA 1', 'ra', crypt('<private-access-code>', gen_salt('bf')))
-- on conflict (display_name) do nothing;

drop function if exists public.dobbs_export_labels(text, text);
drop function if exists public.dobbs_save_label(text, text, text, jsonb);
drop function if exists public.dobbs_get_my_labels(text, text);
drop function if exists public.dobbs_current_annotator(text);

create function public.dobbs_current_annotator(p_access_code text)
returns table (annotator_id uuid, annotator_name text, annotator_role text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select a.id, a.display_name, a.role
  from public.dobbs_labeling_annotators a
  where a.active
    and a.access_code_hash = crypt(p_access_code, a.access_code_hash)
  limit 1;
end;
$$;

create function public.dobbs_get_my_labels(p_access_code text, p_annotation_batch text default 'sub1000_new_tjst_fit_bert_workflow')
returns table (
  annotation_row_id text,
  annotation_batch text,
  human_stance text,
  human_stance_confidence text,
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

create index if not exists dobbs_labeling_labels_annotator_id_idx
  on public.dobbs_labeling_labels (annotator_id);

revoke all on function public.dobbs_current_annotator(text) from public;
revoke all on function public.dobbs_get_my_labels(text, text) from public;
revoke all on function public.dobbs_save_label(text, text, text, jsonb) from public;
revoke all on function public.dobbs_export_labels(text, text) from public;

revoke all on function public.dobbs_current_annotator(text) from authenticated;
revoke all on function public.dobbs_get_my_labels(text, text) from authenticated;
revoke all on function public.dobbs_save_label(text, text, text, jsonb) from authenticated;
revoke all on function public.dobbs_export_labels(text, text) from authenticated;

grant execute on function public.dobbs_current_annotator(text) to anon;
grant execute on function public.dobbs_get_my_labels(text, text) to anon;
grant execute on function public.dobbs_save_label(text, text, text, jsonb) to anon;
grant execute on function public.dobbs_export_labels(text, text) to anon;

notify pgrst, 'reload schema';
