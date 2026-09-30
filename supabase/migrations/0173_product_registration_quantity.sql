-- Every product registration needs a recorded quantity as well as a unit.
alter table public.product_registration_entries
  add column quantity numeric(12, 3) check (quantity is null or quantity >= 0);

create or replace function public.sync_product_registration_entry_status(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.product_registration_entries entry
  set status = case
    when nullif(trim(entry.product_name), '') is not null
      and entry.quantity is not null
      and nullif(trim(entry.unit), '') is not null
      and exists (select 1 from public.product_registration_images image where image.entry_id = entry.id)
    then 'completed'
    else 'draft'
  end,
  updated_at = now()
  where entry.id = p_entry_id;
end;
$$;

drop trigger product_registration_entries_status_from_fields on public.product_registration_entries;

create trigger product_registration_entries_status_from_fields
after insert or update of product_name, quantity, unit on public.product_registration_entries
for each row execute function public.sync_product_registration_entry_from_fields();

update public.product_registration_entries
set status = 'draft'
where quantity is null and status <> 'draft';
