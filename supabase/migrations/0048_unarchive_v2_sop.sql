-- Restore an archived SOP to an unpublished draft. Restoring never republishes
-- content or recreates employee notifications; the administrator must review
-- and publish it again through the normal lifecycle.
create or replace function public.unarchive_v2_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sop public.v2_sops%rowtype;
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;

  update public.v2_sops
  set status = 'draft', published_at = null
  where id = p_sop_id and status = 'archived'
  returning * into v_sop;

  if v_sop.id is null then
    raise exception 'only archived SOP can be restored' using errcode = '55000';
  end if;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    'v2_sop_unarchived',
    'v2_sops',
    v_sop.id,
    jsonb_build_object('restored_status', 'draft')
  );

  return to_jsonb(v_sop);
end;
$$;

revoke all on function public.unarchive_v2_sop(uuid) from public;
grant execute on function public.unarchive_v2_sop(uuid) to authenticated;
