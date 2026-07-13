-- 允许任何有公告管理权限的管理员删除私有公告附件，避免不同管理员之间留下孤儿文件。
drop policy if exists v2_notice_asset_storage_delete on storage.objects;
create policy v2_notice_asset_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'v2-notice-assets'
  and exists (
    select 1
    from public.v2_notice_assets asset
    where asset.object_path = name
      and public.can_manage_v2_notice(asset.notice_id)
  )
);
