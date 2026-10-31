-- Keep stale clients and direct revenue writes aligned with dated business state.
create function public.guard_closed_store_revenue_input() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not public.store_is_operating_on(new.store_id,new.as_of_date) then
    raise exception '该日期门店已关店，不能登记营业额；可选择关店前日期维护历史数据';
  end if;
  return new;
end;
$$;
create trigger payroll_revenue_operating_guard before insert or update on public.payroll_store_revenue_inputs
for each row execute function public.guard_closed_store_revenue_input();
revoke all on function public.guard_closed_store_revenue_input() from public,anon,authenticated;

do $migration$
declare p record; body text; definition text; position integer; patched integer:=0;
begin
  for p in select oid,proname,prosrc from pg_proc where pronamespace='public'::regnamespace
    and proname in('bind_qmai_sales_integration','begin_operation_report_refresh')
  loop
    position:=strpos(p.prosrc,'end if;');
    if position=0 or strpos(p.prosrc,'has_store_access(p_store_id)')=0 then
      raise exception 'Unexpected authorization contract for %',p.proname;
    end if;
    body:=left(p.prosrc,position+6)||E'\n  if not public.store_is_operating_on(p_store_id,(now() at time zone ''Asia/Shanghai'')::date) then\n    raise exception ''门店已关店，不能新建营业同步或绑定；请先恢复营业'';\n  end if;\n'||substring(p.prosrc from position+7);
    if p.proname='begin_operation_report_refresh' then
      body:=replace(body,'  select * into v_report from public.operation_reports',E'  if not public.store_is_operating_on(p_store_id,p_report_date) then\n    raise exception ''该日期门店已关店，不能生成营业报告'';\n  end if;\n  select * into v_report from public.operation_reports');
    end if;
    definition:=replace(pg_get_functiondef(p.oid),p.prosrc,body);
    execute definition;
    patched:=patched+1;
  end loop;
  if patched<>2 then raise exception 'Expected 2 business entry functions, got %',patched; end if;
  select oid,prosrc into strict p from pg_proc where pronamespace='public'::regnamespace and proname='get_operation_report_availability';
  if strpos(p.prosrc,'''available'', true,')=0 then raise exception 'Unexpected report availability contract'; end if;
  body:=replace(p.prosrc,'''available'', true,','''available'', true, ''operating'', public.store_is_operating_on(p_store_id,(now() at time zone ''Asia/Shanghai'')::date),');
  execute replace(pg_get_functiondef(p.oid),p.prosrc,body);
end;
$migration$;
notify pgrst,'reload schema';
