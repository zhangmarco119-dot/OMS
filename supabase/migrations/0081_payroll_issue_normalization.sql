-- Later payroll wrappers can legitimately resolve an issue raised by the base
-- calculator (for example probation proration or revenue carry-forward). Keep
-- the visible issue list consistent with the final completeness flag.

alter function public.get_payroll_estimate(uuid,date)
  rename to calculate_payroll_estimate_before_issue_normalization;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_issues jsonb := '[]'::jsonb;
begin
  v_result := public.calculate_payroll_estimate_before_issue_normalization(p_profile_id,p_as_of);
  if coalesce((v_result->>'dataComplete')::boolean,false) then
    return jsonb_set(v_result,'{dataIssues}','[]'::jsonb,true);
  end if;
  select coalesce(jsonb_agg(distinct issue), '[]'::jsonb)
    into v_issues
  from jsonb_array_elements_text(coalesce(v_result->'dataIssues','[]'::jsonb)) issue
  where issue <> '该月营业收入或提成门店范围待完善';
  if jsonb_array_length(v_issues)=0 then v_issues:=jsonb_build_array('工资数据待完善'); end if;
  return jsonb_set(v_result,'{dataIssues}',v_issues,true);
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_issue_normalization(uuid,date) from public,anon,authenticated;
revoke all on function public.get_payroll_estimate(uuid,date) from public,anon;
grant execute on function public.get_payroll_estimate(uuid,date) to authenticated;
