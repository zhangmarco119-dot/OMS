-- Statutory dates, not the surrounding compensatory-leave/weekend dates.
-- Sources: https://www.gov.cn/zhengce/content/202411/content_6986380.htm
-- https://www.gov.cn/zhengce/content/202511/content_7047091.htm
create table private.payroll_statutory_holidays (
  holiday_date date primary key,
  holiday_name text not null
);
revoke all on private.payroll_statutory_holidays from public, anon, authenticated;
insert into private.payroll_statutory_holidays values
 ('2025-01-01','元旦'),('2025-01-28','春节'),('2025-01-29','春节'),('2025-01-30','春节'),('2025-01-31','春节'),
 ('2025-04-04','清明节'),('2025-05-01','劳动节'),('2025-05-02','劳动节'),('2025-05-31','端午节'),
 ('2025-10-01','国庆节'),('2025-10-02','国庆节'),('2025-10-03','国庆节'),('2025-10-06','中秋节'),
 ('2026-01-01','元旦'),('2026-02-16','春节'),('2026-02-17','春节'),('2026-02-18','春节'),('2026-02-19','春节'),
 ('2026-04-05','清明节'),('2026-05-01','劳动节'),('2026-05-02','劳动节'),('2026-06-19','端午节'),
 ('2026-09-25','中秋节'),('2026-10-01','国庆节'),('2026-10-02','国庆节'),('2026-10-03','国庆节');

create table private.payroll_holiday_subsidies (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null check (extract(day from payroll_month)=1),
  amount numeric(12,2) not null check (amount>=0 and amount<10000000000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(profile_id,payroll_month)
);
revoke all on private.payroll_holiday_subsidies from public, anon, authenticated;

create function private.payroll_holiday_work_dates(p_profile_id uuid,p_from date,p_to date)
returns date[] language sql stable security definer set search_path=public,private as $$
 select coalesce(array_agg(distinct worked.work_date order by worked.work_date),'{}'::date[])
 from (
  select attendance_date as work_date from public.attendance_daily_records
  where profile_id=p_profile_id and is_attended and attendance_date between p_from and p_to
  union
  select overtime_date from public.payroll_overtime_requests
  where profile_id=p_profile_id and status='approved' and hours>0 and overtime_date between p_from and p_to
 ) worked join private.payroll_statutory_holidays holiday on holiday.holiday_date=worked.work_date;
$$;
revoke all on function private.payroll_holiday_work_dates(uuid,date,date) from public,anon,authenticated;

-- Add gross income before the existing estimated-tax calculation, not after it.
alter function public.calculate_payroll_estimate_before_estimated_individual_tax(uuid,date)
 rename to calculate_payroll_estimate_before_holiday_subsidy;
create function public.calculate_payroll_estimate_before_estimated_individual_tax(p_profile_id uuid,p_as_of date)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
 v_result jsonb; v_month date:=date_trunc('month',p_as_of)::date;
 v_dates date[]; v_amount numeric:=0;
begin
 v_result:=public.calculate_payroll_estimate_before_holiday_subsidy(p_profile_id,p_as_of);
 v_dates:=private.payroll_holiday_work_dates(p_profile_id,v_month,p_as_of);
 if cardinality(v_dates)>0 then
  select coalesce(amount,0) into v_amount from private.payroll_holiday_subsidies where profile_id=p_profile_id and payroll_month=v_month;
 end if;
 v_amount:=coalesce(v_amount,0);
 return v_result || jsonb_build_object(
  'holidayAttendanceDates',to_jsonb(v_dates),'holidaySubsidy',v_amount,
  'incomeSubtotalKnown',coalesce((v_result->>'incomeSubtotalKnown')::numeric,0)+v_amount,
  'knownEstimatedPayable',coalesce((v_result->>'knownEstimatedPayable')::numeric,0)+v_amount,
  'estimatedPayable',case when v_result->>'estimatedPayable' is null then null else (v_result->>'estimatedPayable')::numeric+v_amount end
 );
end;
$$;
revoke all on function public.calculate_payroll_estimate_before_holiday_subsidy(uuid,date),public.calculate_payroll_estimate_before_estimated_individual_tax(uuid,date) from public,anon,authenticated;

create function private.attach_payroll_holiday_metadata()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_dates date[]; v_amount numeric:=0;
begin
 v_dates:=private.payroll_holiday_work_dates(new.profile_id,new.payroll_month,
  least((new.payroll_month+interval '1 month - 1 day')::date,coalesce(nullif(new.estimate_snapshot->>'asOf','')::date,(new.payroll_month+interval '1 month - 1 day')::date)));
 if cardinality(v_dates)>0 then
  select amount into v_amount from private.payroll_holiday_subsidies where profile_id=new.profile_id and payroll_month=new.payroll_month;
 end if;
 new.estimate_snapshot:=new.estimate_snapshot || jsonb_build_object('holidayAttendanceDates',to_jsonb(v_dates),'holidaySubsidy',coalesce(v_amount,0));
 return new;
end;
$$;
revoke all on function private.attach_payroll_holiday_metadata() from public,anon,authenticated;
create trigger payroll_payslips_holiday_metadata before insert or update of estimate_snapshot on public.payroll_payslips
 for each row execute function private.attach_payroll_holiday_metadata();

-- Existing statements only gain a zero-valued item; no revision, confirmation,
-- notification or monetary total is changed by this metadata backfill.
update public.payroll_payslips set estimate_snapshot=estimate_snapshot
 where cardinality(private.payroll_holiday_work_dates(profile_id,payroll_month,
  least((payroll_month+interval '1 month - 1 day')::date,coalesce(nullif(estimate_snapshot->>'asOf','')::date,(payroll_month+interval '1 month - 1 day')::date))))>0;

alter function public.admin_update_payroll_payslip(uuid,jsonb) rename to admin_update_payroll_payslip_before_holiday_subsidy;
create function public.admin_update_payroll_payslip(p_payslip_id uuid,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
 v_row public.payroll_payslips; v_dates date[]; v_amount numeric; v_income numeric; v_payable numeric;
begin
 select * into v_row from public.payroll_payslips where id=p_payslip_id for update;
 if v_row.id is null or public.current_user_role()<>'admin' or not public.can_admin_manage_attendance_profile(v_row.profile_id) then raise exception '没有该工资单的操作权限'; end if;
 v_dates:=private.payroll_holiday_work_dates(v_row.profile_id,v_row.payroll_month,
  least((v_row.payroll_month+interval '1 month - 1 day')::date,coalesce(nullif(v_row.estimate_snapshot->>'asOf','')::date,(v_row.payroll_month+interval '1 month - 1 day')::date)));
 v_amount:=case when p_fields ? 'holidaySubsidy' then coalesce(nullif(p_fields->>'holidaySubsidy','')::numeric,0) else coalesce((v_row.estimate_snapshot->>'holidaySubsidy')::numeric,0) end;
 if v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount>=10000000000 then raise exception '节假日补贴金额必须为有效的非负数'; end if;
 if cardinality(v_dates)=0 and v_amount<>0 then raise exception '该月份没有法定节假日出勤，不能登记节假日补贴'; end if;
 insert into private.payroll_holiday_subsidies(profile_id,payroll_month,amount,updated_by)
 values(v_row.profile_id,v_row.payroll_month,round(v_amount,2),auth.uid())
 on conflict(profile_id,payroll_month) do update set amount=excluded.amount,updated_by=excluded.updated_by,updated_at=now();
 perform public.admin_update_payroll_payslip_before_holiday_subsidy(p_payslip_id,p_fields);
 select * into v_row from public.payroll_payslips where id=p_payslip_id;
 if v_row.estimate_snapshot->>'employmentType'='part_time' then
  v_income:=coalesce((v_row.estimate_snapshot->>'accruedPartTimeWage')::numeric,0)+round(v_amount,2);
 else
  v_income:=coalesce((v_row.estimate_snapshot->>'incomeSubtotalKnown')::numeric,0)+round(v_amount,2);
 end if;
 v_payable:=v_income-coalesce((v_row.estimate_snapshot->>'fineTotal')::numeric,0)-coalesce((v_row.estimate_snapshot->>'individualIncomeTax')::numeric,0);
 update public.payroll_payslips set estimate_snapshot=estimate_snapshot||jsonb_build_object(
  'holidayAttendanceDates',to_jsonb(v_dates),'holidaySubsidy',round(v_amount,2),
  'incomeSubtotalKnown',v_income,'knownEstimatedPayable',v_payable,'knownEstimatedNetPayable',v_payable,
  'estimatedPayable',v_payable,'estimatedNetPayable',v_payable
 ) where id=p_payslip_id returning * into v_row;
 return to_jsonb(v_row);
end;
$$;
revoke all on function public.admin_update_payroll_payslip_before_holiday_subsidy(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.admin_update_payroll_payslip(uuid,jsonb) from public,anon;
grant execute on function public.admin_update_payroll_payslip(uuid,jsonb) to authenticated;
