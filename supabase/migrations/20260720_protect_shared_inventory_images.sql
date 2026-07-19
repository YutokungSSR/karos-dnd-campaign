drop policy if exists "inventory images deleted by owner and dm" on storage.objects;

create policy "inventory images deleted by owner and dm"
on storage.objects
for delete
using (
  bucket_id = 'inventory-item-images'
  and (
    select private.can_view_character_inventory(
      private.inventory_character_id_from_path(storage.objects.name)
    )
  )
  and not exists (
    select 1
    from public.inventory_items i
    where i.image_path = storage.objects.name
  )
);
