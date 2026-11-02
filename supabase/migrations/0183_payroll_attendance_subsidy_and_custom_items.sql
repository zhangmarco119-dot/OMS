-- Monthly additions are owned by the payroll month, never by the current date.
create table private.payroll_custom_items (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null check (extract(day from payroll_month)=1),
  items jsonb not null default '[]' check (jsonb_typeof(items)='array'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(profile_id,payroll_month)
);
revoke all on private.payroll_custom_items from public,anon,authenticated;

create function private.normalize_payroll_custom_items(p_items jsonb)
returns jsonb language plpgsql set search_path=public,private as $$
declare v_item jsonb; v_name text; v_amount numeric; v_id uuid; v_result jsonb:='[]';
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception '工资条目必须为列表'; end if;
  if jsonb_array_length(p_items)>50 then raise exception '每月最多添加 50 个工资条目'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name:=btrim(coalesce(v_item->>'name',''));
    if length(v_name) not between 1 and 50 then raise exception '条目名称需要 1 至 50 个字'; end if;
    v_amount:=nullif(v_item->>'amount','')::numeric;
    if v_amount is null or v_amount<0 or v_amount>=10000000000 or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception '条目金额必须为有效的非负数'; end if;
    v_id:=coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from jsonb_array_elements(v_result) r where r->>'id'=v_id::text) then raise exception '工资条目不能重复'; end if;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_id,'name',v_name,'amount',round(v_amount,2)));
  end loop;
  return v_result;
end;
$$;
revoke all on function private.normalize_payroll_custom_items(jsonb) from public,anon,authenticated;

create function public.admin_save_payroll_custom_items(p_profile_id uuid,p_payroll_month date,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_items jsonb;
begin
  if public.current_user_role() is distinct from 'admin' or public.can_admin_manage_attendance_profile(p_profile_id) is not true then raise exception '没有该员工的工资管理权限' using errcode='42501'; end if;
  if p_payroll_month is null or extract(day from p_payroll_month)<>1 or p_payroll_month>date_trunc('month',now() at time zone 'Asia/Shanghai')::date then raise exception '请选择有效的工资月份'; end if;
  v_items:=private.normalize_payroll_custom_items(p_items);
  insert into private.payroll_custom_items(profile_id,payroll_month,items,updated_by)
  values(p_profile_id,p_payroll_month,v_items,auth.uid())
  on conflict(profile_id,payroll_month) do update set items=excluded.items,updated_by=excluded.updated_by,updated_at=now();
  insert into public.system_operation_logs(actor_id,actor_name_snapshot,actor_username_snapshot,actor_role_snapshot,actor_employment_type_snapshot,store_id,module,operation,summary,entity_type,entity_id,metadata)
  select actor.id,actor.display_name,actor.username,actor.role,actor.employment_type,p.store_id,'payroll','updated','调整月度工资条目','profile',p.id,
    jsonb_build_object('payrollMonth',p_payroll_month,'itemCount',jsonb_array_length(v_items)) from public.profiles p cross join public.profiles actor where p.id=p_profile_id and actor.id=auth.uid();
  return v_items;
end;
$$;
revoke all on function public.admin_save_payroll_custom_items(uuid,date,jsonb) from public,anon;
grant execute on function public.admin_save_payroll_custom_items(uuid,date,jsonb) to authenticated;

-- Previously zero meant "not entered". Preserve intentional positive overrides;
-- zero placeholders now use automatic attendance-based calculation.
alter table private.payroll_holiday_subsidies add column calculation_mode text not null default 'automatic' check(calculation_mode in ('automatic','manual'));
update private.payroll_holiday_subsidies set calculation_mode='manual' where amount>0;

create or replace function private.payroll_holiday_work_dates(p_profile_id uuid,p_from date,p_to date)
returns date[] language sql stable security definer set search_path=public,private as $$
 select coalesce(array_agg(distinct worked.work_date order by worked.work_date),'{}'::date[])
 from (
  select attendance_date as work_date from public.attendance_daily_records
  where profile_id=p_profile_id and is_attended and attendance_date between p_from and p_to
  union
  select overtime_date from public.payroll_overtime_requests
  where profile_id=p_profile_id and status='approved' and hours>0 and overtime_date between p_from and p_to
    and exists(select 1 from public.profiles p where p.id=p_profile_id and p.employment_type='part_time')
 ) worked join private.payroll_statutory_holidays holiday on holiday.holiday_date=worked.work_date;
$$;

-- This layer runs before estimated tax, after probation/departure/closure rules.
create or replace function public.calculate_payroll_estimate_before_estimated_individual_tax(p_profile_id uuid,p_as_of date default ((now() at time zone 'Asia/Shanghai')::date))
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
 v_result jsonb; v_month date:=date_trunc('month',p_as_of)::date;
 v_days integer:=extract(day from (v_month+interval '1 month - 1 day'))::integer-4;
 v_dates date[]; v_holiday numeric:=0; v_auto numeric:=0; v_mode text:='automatic';
 v_items jsonb; v_custom numeric; v_delta numeric; v_commission numeric; v_attendance numeric;
begin
 v_result:=public.calculate_payroll_estimate_before_holiday_subsidy(p_profile_id,p_as_of);
 v_dates:=private.payroll_holiday_work_dates(p_profile_id,v_month,p_as_of);
 if v_result->>'employmentType'='full_time' then v_auto:=round(2200::numeric/v_days*cardinality(v_dates),2); end if;
 select amount,calculation_mode into v_holiday,v_mode from private.payroll_holiday_subsidies where profile_id=p_profile_id and payroll_month=v_month;
 v_mode:=coalesce(v_mode,'automatic');
 v_holiday:=case when cardinality(v_dates)=0 then 0 when v_mode='manual' or v_result->>'employmentType'='part_time' then coalesce(v_holiday,0) else v_auto end;
 select items into v_items from private.payroll_custom_items where profile_id=p_profile_id and payroll_month=v_month;
 v_items:=coalesce(v_items,'[]');
 select coalesce(sum((value->>'amount')::numeric),0) into v_custom from jsonb_array_elements(v_items);
 v_delta:=v_holiday+v_custom;
 v_attendance:=coalesce((v_result->>'eligibleAttendanceDays')::numeric,(v_result->>'attendanceDays')::numeric,0);
 if v_result->>'employmentType'='full_time' and coalesce((v_result->>'commissionEnabled')::boolean,false)
   and coalesce((v_result->>'commissionReady')::boolean,false)
   and not coalesce((v_result->>'departureMonthExcluded')::boolean,false) and v_result->>'accruedCommission' is not null then
   v_commission:=round(coalesce((v_result->>'revenueTotal')::numeric,0)*coalesce((v_result->>'commissionRate')::numeric,0)*v_attendance/v_days,2);
   v_delta:=v_delta+v_commission-coalesce((v_result->>'accruedCommission')::numeric,0);
   v_result:=v_result||jsonb_build_object('accruedCommission',v_commission);
 end if;
 return v_result||jsonb_build_object(
  'holidayAttendanceDates',to_jsonb(v_dates),'holidaySubsidy',v_holiday,'holidaySubsidyAutomatic',v_auto,'holidaySubsidyMode',v_mode,
  'holidaySubsidyBase',2200,'payrollStandardDays',v_days,'commissionAttendanceDays',v_attendance,
  'customItems',v_items,'customItemsTotal',v_custom,
  'incomeSubtotalKnown',round(coalesce((v_result->>'incomeSubtotalKnown')::numeric,0)+v_delta,2),
  'knownEstimatedPayable',round(coalesce((v_result->>'knownEstimatedPayable')::numeric,0)+v_delta,2),
  'estimatedPayable',case when v_result->>'estimatedPayable' is null then null else round((v_result->>'estimatedPayable')::numeric+v_delta,2) end
 );
end;
$$;

-- Do not replace a newly generated calculated subsidy with the old default 0.
-- Snapshot amounts stay frozen when attendance or monthly additions later change.
create or replace function private.attach_payroll_holiday_metadata()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
 if not (new.estimate_snapshot ? 'holidaySubsidy') then
  new.estimate_snapshot:=new.estimate_snapshot||jsonb_build_object('holidaySubsidy',0,'holidayAttendanceDates','[]'::jsonb);
 end if;
 return new;
end;
$$;

create or replace function public.admin_update_payroll_payslip(p_payslip_id uuid,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_row public.payroll_payslips; v_dates date[]; v_amount numeric; v_income numeric; v_payable numeric; v_items jsonb; v_custom numeric;
begin
 select * into v_row from public.payroll_payslips where id=p_payslip_id for update;
 if v_row.id is null or public.current_user_role() is distinct from 'admin' or not public.can_admin_manage_attendance_profile(v_row.profile_id) then raise exception '没有该工资单的操作权限' using errcode='42501'; end if;
 if v_row.status='withdrawn' then raise exception '已撤回工资单不能修改，请重新生成'; end if;
 v_dates:=coalesce(array(select jsonb_array_elements_text(v_row.estimate_snapshot->'holidayAttendanceDates')::date),'{}'::date[]);
 v_amount:=case when p_fields ? 'holidaySubsidy' then nullif(p_fields->>'holidaySubsidy','')::numeric else coalesce((v_row.estimate_snapshot->>'holidaySubsidy')::numeric,0) end;
 if v_amount is null or v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount>=10000000000 then raise exception '节假日补贴金额必须为有效的非负数'; end if;
 if cardinality(v_dates)=0 and v_amount<>0 then raise exception '该月份没有法定节假日出勤，不能登记节假日补贴'; end if;
 -- Old clients submit all amounts even when untouched; do not accidentally
 -- turn an automatic subsidy into a manual override on an unrelated edit.
 if p_fields ? 'holidaySubsidy' and v_amount is distinct from coalesce((v_row.estimate_snapshot->>'holidaySubsidy')::numeric,0) then
  insert into private.payroll_holiday_subsidies(profile_id,payroll_month,amount,updated_by,calculation_mode)
  values(v_row.profile_id,v_row.payroll_month,round(v_amount,2),auth.uid(),'manual')
  on conflict(profile_id,payroll_month) do update set amount=excluded.amount,updated_by=excluded.updated_by,updated_at=now(),calculation_mode='manual';
 end if;
 v_items:=case when p_fields ? 'customItems' then public.admin_save_payroll_custom_items(v_row.profile_id,v_row.payroll_month,p_fields->'customItems') else coalesce(v_row.estimate_snapshot->'customItems','[]') end;
 select coalesce(sum((value->>'amount')::numeric),0) into v_custom from jsonb_array_elements(v_items);
 -- Existing inner function owns revision, confirmation reset and notifications.
 perform public.admin_update_payroll_payslip_before_holiday_subsidy(p_payslip_id,p_fields);
 select * into v_row from public.payroll_payslips where id=p_payslip_id;
 if v_row.estimate_snapshot->>'employmentType'='part_time' then
  v_income:=coalesce((v_row.estimate_snapshot->>'accruedPartTimeWage')::numeric,0)+round(v_amount,2)+v_custom;
 else
  v_income:=coalesce((v_row.estimate_snapshot->>'incomeSubtotalKnown')::numeric,0)+round(v_amount,2)+v_custom;
 end if;
 v_payable:=v_income-coalesce((v_row.estimate_snapshot->>'fineTotal')::numeric,0)-coalesce((v_row.estimate_snapshot->>'individualIncomeTax')::numeric,0);
 update public.payroll_payslips set estimate_snapshot=estimate_snapshot||jsonb_build_object(
  'holidaySubsidy',round(v_amount,2),'customItems',v_items,'customItemsTotal',v_custom,
  'incomeSubtotalKnown',v_income,'knownEstimatedPayable',v_payable,'knownEstimatedNetPayable',v_payable,
  'estimatedPayable',v_payable,'estimatedNetPayable',v_payable
 ) where id=p_payslip_id returning * into v_row;
 return to_jsonb(v_row);
end;
$$;
notify pgrst,'reload schema';
