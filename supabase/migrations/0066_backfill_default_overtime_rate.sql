-- Ensure the default overtime rate also covers dates before this feature was deployed.
insert into public.payroll_overtime_rates(
  hourly_rate,
  effective_from,
  effective_to,
  change_reason,
  created_by
)
select
  25,
  date '2000-01-01',
  min(effective_from) - 1,
  '历史日期默认加班时薪',
  null
from public.payroll_overtime_rates
where effective_from > date '2000-01-01'
on conflict (effective_from) do nothing;
