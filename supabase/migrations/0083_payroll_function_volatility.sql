-- Payroll aggregation reads attendance, revenue and other values that may
-- change during the same transaction. Do not advertise these routines as
-- STABLE while their internal calculation functions are VOLATILE.

alter function public.calculate_admin_payroll_estimates_internal(date, uuid, text) volatile;
alter function public.admin_payroll_estimates(date, uuid, text) volatile;
