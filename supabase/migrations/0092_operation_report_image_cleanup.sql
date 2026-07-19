-- Uploaded report photos must remain removable after their metadata row has
-- been deleted. Storage ownership is the durable authorization source.
drop policy if exists operation_report_storage_delete on storage.objects;
create policy operation_report_storage_delete on storage.objects for delete to authenticated
using (bucket_id='operation-report-images' and owner_id=auth.uid()::text);
