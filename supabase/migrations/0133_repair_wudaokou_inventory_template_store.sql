-- The production "点货" template was published only for the Xizhimen store,
-- while the task publishing page still allowed Wudaokou to be selected. Add
-- the missing intended store assignment; the insert is a no-op in environments
-- where either production record is absent.
insert into public.v2_task_template_stores(template_id, store_id)
select template.id, store.id
from public.v2_task_templates template
join public.stores store on store.id = '00000000-0000-4000-8000-000000000001'::uuid
where template.id = 'a598e3a7-dc03-495f-8ba5-4f842387d6e5'::uuid
  and template.name = '点货'
  and store.name = '宝珠奶酪（五道口店）'
on conflict (template_id, store_id) do nothing;
