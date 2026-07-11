begin;

do $$
begin
  if exists (
    select 1 from storage.objects where bucket_id = 'arrival-report-images'
  ) then
    raise exception 'arrival-report-images is not empty; export and remove its objects before rollback';
  end if;
end;
$$;

drop policy if exists arrival_images_storage_delete on storage.objects;
drop policy if exists arrival_images_storage_insert on storage.objects;
drop policy if exists arrival_images_storage_select on storage.objects;

delete from storage.buckets where id = 'arrival-report-images';

drop view if exists public.arrival_daily_product_summary_view;
drop view if exists public.arrival_daily_detail_view;

drop function if exists public.can_write_arrival_image_object(text);
drop function if exists public.can_read_arrival_image_object(text);
drop function if exists public.void_arrival_report(uuid, text);
drop function if exists public.mark_arrival_viewed(uuid);
drop function if exists public.submit_arrival_report(uuid, integer, text);
drop function if exists public.generate_arrival_summary(uuid);
drop function if exists public.can_edit_arrival_report(uuid);
drop function if exists public.can_read_arrival_report(uuid);
drop function if exists public.can_operate_arrival_modules(uuid);

drop table if exists public.notifications;
drop table if exists public.arrival_report_images;
drop table if exists public.arrival_report_items;
drop table if exists public.arrival_reports;

drop function if exists public.validate_arrival_report_image();
drop function if exists public.validate_arrival_report_item();
drop function if exists public.touch_arrival_report();
drop function if exists public.set_arrival_report_snapshots();
drop function if exists public.generate_arrival_report_no();
drop sequence if exists public.arrival_report_number_seq;

commit;
