-- MMORPG inventory: private owner/DM reads, DM-only management, equipment,
-- slot capacity, and private item artwork.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.can_view_character_inventory(target_character uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.characters c
      left join public.campaigns campaign on campaign.id = c.campaign_id
      where c.id = target_character
        and (
          c.owner_id = (select auth.uid())
          or campaign.dm_user_id = (select auth.uid())
        )
    );
$$;

create or replace function private.can_manage_character_inventory(target_character uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.characters c
      join public.campaigns campaign on campaign.id = c.campaign_id
      where c.id = target_character
        and campaign.dm_user_id = (select auth.uid())
    );
$$;

create or replace function private.inventory_character_id_from_path(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(split_part(object_name, '/', 1), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function private.can_view_character_inventory(uuid) from public, anon;
revoke all on function private.can_manage_character_inventory(uuid) from public, anon;
revoke all on function private.inventory_character_id_from_path(text) from public, anon;
grant execute on function private.can_view_character_inventory(uuid) to authenticated;
grant execute on function private.can_manage_character_inventory(uuid) to authenticated;
grant execute on function private.inventory_character_id_from_path(text) to authenticated;

create table if not exists public.character_inventories (
  character_id uuid primary key references public.characters(id) on delete cascade,
  capacity integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_inventories_capacity_check check (capacity between 1 and 200)
);

alter table public.inventory_items
  add column if not exists category text not null default 'item',
  add column if not exists image_path text,
  add column if not exists slot_index integer,
  add column if not exists allowed_equipment_slot text,
  add column if not exists equipment_slot text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from public.inventory_items
    group by character_id
    having count(*) > 200
  ) then
    raise exception 'A character has more than the supported 200 inventory stacks';
  end if;
end;
$$;

insert into public.character_inventories (character_id, capacity)
select c.id, greatest(10, count(i.id)::integer)
from public.characters c
left join public.inventory_items i on i.character_id = c.id
group by c.id
on conflict (character_id) do update
set capacity = greatest(public.character_inventories.capacity, excluded.capacity);

update public.inventory_items
set quantity = 1
where quantity < 1;

update public.inventory_items
set category = case
  when lower(trim(item_type)) in ('food', 'อาหาร') then 'food'
  when lower(trim(item_type)) in ('weapon', 'อาวุธ') then 'weapon'
  when lower(trim(item_type)) in ('equipment', 'เครื่องสวมใส่', 'ชุด', 'เกราะ') then 'equipment'
  else 'item'
end;

update public.inventory_items
set allowed_equipment_slot = case
  when category = 'weapon' then 'hand'
  when category = 'equipment' then 'chest'
  else null
end;

with ranked_items as (
  select
    id,
    row_number() over (partition by character_id order by created_at, id)::integer - 1 as next_slot
  from public.inventory_items
)
update public.inventory_items item
set
  slot_index = ranked_items.next_slot,
  equipment_slot = null,
  equipped = false
from ranked_items
where item.id = ranked_items.id
  and item.slot_index is null;

alter table public.inventory_items
  alter column slot_index set not null;

alter table public.inventory_items drop constraint if exists inventory_items_quantity_check;
alter table public.inventory_items drop constraint if exists inventory_items_category_check;
alter table public.inventory_items drop constraint if exists inventory_items_slot_index_check;
alter table public.inventory_items drop constraint if exists inventory_items_allowed_equipment_slot_check;
alter table public.inventory_items drop constraint if exists inventory_items_allowed_equipment_category_check;
alter table public.inventory_items drop constraint if exists inventory_items_equipment_slot_check;
alter table public.inventory_items drop constraint if exists inventory_items_equipment_category_check;

alter table public.inventory_items
  add constraint inventory_items_quantity_check check (quantity >= 1),
  add constraint inventory_items_category_check check (category in ('food', 'weapon', 'equipment', 'item')),
  add constraint inventory_items_slot_index_check check (slot_index >= 0),
  add constraint inventory_items_allowed_equipment_slot_check check (
    allowed_equipment_slot is null
    or allowed_equipment_slot in ('head', 'neck', 'chest', 'ring', 'legs', 'feet', 'hand')
  ),
  add constraint inventory_items_allowed_equipment_category_check check (
    coalesce(
      (category = 'weapon' and allowed_equipment_slot = 'hand')
      or (category = 'equipment' and allowed_equipment_slot in ('head', 'neck', 'chest', 'ring', 'legs', 'feet'))
      or (category in ('food', 'item') and allowed_equipment_slot is null),
      false
    )
  ),
  add constraint inventory_items_equipment_slot_check check (
    equipment_slot is null
    or equipment_slot in ('head', 'neck', 'chest', 'ring', 'legs', 'feet', 'left_hand', 'right_hand')
  ),
  add constraint inventory_items_equipment_category_check check (
    coalesce(
      equipment_slot is null
      or (allowed_equipment_slot = 'hand' and equipment_slot in ('left_hand', 'right_hand'))
      or allowed_equipment_slot = equipment_slot,
      false
    )
  );

drop index if exists public.inventory_items_character_slot_uidx;
alter table public.inventory_items drop constraint if exists inventory_items_character_slot_unique;
alter table public.inventory_items
  add constraint inventory_items_character_slot_unique
  unique (character_id, slot_index) deferrable initially immediate;
create unique index if not exists inventory_items_character_equipment_uidx
  on public.inventory_items(character_id, equipment_slot)
  where equipment_slot is not null;
create index if not exists inventory_items_character_category_idx
  on public.inventory_items(character_id, category);

create or replace function private.initialize_character_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.character_inventories (character_id, capacity)
  values (new.id, 10)
  on conflict (character_id) do nothing;
  return new;
end;
$$;

create or replace function private.validate_inventory_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  highest_used_slot integer;
begin
  select coalesce(max(slot_index), -1)
  into highest_used_slot
  from public.inventory_items
  where character_id = new.character_id;

  if new.capacity <= highest_used_slot then
    raise exception 'Inventory capacity cannot be lower than the highest occupied slot';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.validate_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capacity_limit integer;
begin
  if tg_op = 'UPDATE' and new.character_id <> old.character_id then
    raise exception 'Inventory items cannot be moved between characters';
  end if;

  select capacity
  into capacity_limit
  from public.character_inventories
  where character_id = new.character_id
  for update;

  if capacity_limit is null then
    raise exception 'Character inventory settings are missing';
  end if;

  if new.slot_index is null then
    select candidate.slot_index
    into new.slot_index
    from generate_series(0, capacity_limit - 1) as candidate(slot_index)
    where not exists (
      select 1
      from public.inventory_items existing_item
      where existing_item.character_id = new.character_id
        and existing_item.slot_index = candidate.slot_index
    )
    order by candidate.slot_index
    limit 1;
  end if;

  if new.slot_index is null then
    raise exception 'Inventory is full';
  end if;

  if new.slot_index < 0 or new.slot_index >= capacity_limit then
    raise exception 'Inventory slot is outside the current capacity';
  end if;

  new.equipped := new.equipment_slot is not null;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.initialize_character_inventory() from public, anon, authenticated;
revoke all on function private.validate_inventory_capacity() from public, anon, authenticated;
revoke all on function private.validate_inventory_item() from public, anon, authenticated;

drop trigger if exists character_initialize_inventory on public.characters;
create trigger character_initialize_inventory
after insert on public.characters
for each row execute function private.initialize_character_inventory();

drop trigger if exists character_inventories_updated_at on public.character_inventories;
create trigger character_inventories_updated_at
before update on public.character_inventories
for each row execute function private.validate_inventory_capacity();

drop trigger if exists inventory_items_validate on public.inventory_items;
create trigger inventory_items_validate
before insert or update on public.inventory_items
for each row execute function private.validate_inventory_item();

create or replace function public.equip_inventory_item(target_item_id uuid, target_slot text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_character uuid;
  target_category text;
  target_allowed_slot text;
begin
  select character_id, category, allowed_equipment_slot
  into target_character, target_category, target_allowed_slot
  from public.inventory_items
  where id = target_item_id
  for update;

  if target_character is null then
    raise exception 'Inventory item not found';
  end if;

  if not private.can_manage_character_inventory(target_character) then
    raise exception 'Only the campaign DM can equip inventory items';
  end if;

  if target_slot is null or not coalesce(
    (target_category = 'weapon' and target_allowed_slot = 'hand' and target_slot in ('left_hand', 'right_hand'))
    or (target_category = 'equipment' and target_allowed_slot = target_slot),
    false
  ) then
    raise exception 'This item cannot be equipped in the selected slot';
  end if;

  update public.inventory_items
  set equipment_slot = null
  where character_id = target_character
    and equipment_slot = target_slot
    and id <> target_item_id;

  update public.inventory_items
  set equipment_slot = target_slot
  where id = target_item_id;
end;
$$;

create or replace function public.resize_character_inventory(target_character_id uuid, target_capacity integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_capacity integer;
  item_count integer;
begin
  if target_capacity is null or target_capacity < 1 or target_capacity > 200 then
    raise exception 'Inventory capacity must be between 1 and 200';
  end if;

  if not private.can_manage_character_inventory(target_character_id) then
    raise exception 'Only the campaign DM can resize this inventory';
  end if;

  select capacity
  into current_capacity
  from public.character_inventories
  where character_id = target_character_id
  for update;

  if current_capacity is null then
    raise exception 'Character inventory settings are missing';
  end if;

  select count(*)::integer
  into item_count
  from public.inventory_items
  where character_id = target_character_id;

  if item_count > target_capacity then
    raise exception 'Inventory capacity cannot be lower than the number of item stacks';
  end if;

  set constraints public.inventory_items_character_slot_unique deferred;

  with ranked_items as (
    select id, row_number() over (order by slot_index, created_at, id)::integer - 1 as next_slot
    from public.inventory_items
    where character_id = target_character_id
  )
  update public.inventory_items item
  set slot_index = ranked_items.next_slot
  from ranked_items
  where item.id = ranked_items.id;

  update public.character_inventories
  set capacity = target_capacity
  where character_id = target_character_id;
end;
$$;

create or replace function public.unequip_inventory_item(target_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_character uuid;
begin
  select character_id
  into target_character
  from public.inventory_items
  where id = target_item_id
  for update;

  if target_character is null then
    raise exception 'Inventory item not found';
  end if;

  if not private.can_manage_character_inventory(target_character) then
    raise exception 'Only the campaign DM can unequip inventory items';
  end if;

  update public.inventory_items
  set equipment_slot = null
  where id = target_item_id;
end;
$$;

revoke all on function public.equip_inventory_item(uuid, text) from public, anon;
revoke all on function public.unequip_inventory_item(uuid) from public, anon;
revoke all on function public.resize_character_inventory(uuid, integer) from public, anon;
grant execute on function public.equip_inventory_item(uuid, text) to authenticated;
grant execute on function public.unequip_inventory_item(uuid) to authenticated;
grant execute on function public.resize_character_inventory(uuid, integer) to authenticated;

alter table public.character_inventories enable row level security;
alter table public.inventory_items enable row level security;

drop policy if exists "view permitted items" on public.inventory_items;
drop policy if exists "edit permitted items insert" on public.inventory_items;
drop policy if exists "edit permitted items update" on public.inventory_items;
drop policy if exists "edit permitted items delete" on public.inventory_items;
drop policy if exists "owner and dm view inventory settings" on public.character_inventories;
drop policy if exists "dm updates inventory settings" on public.character_inventories;

create policy "owner and dm view inventory settings"
on public.character_inventories for select
to authenticated
using ((select private.can_view_character_inventory(character_id)));

create policy "dm updates inventory settings"
on public.character_inventories for update
to authenticated
using ((select private.can_manage_character_inventory(character_id)))
with check ((select private.can_manage_character_inventory(character_id)));

create policy "owner and dm view inventory items"
on public.inventory_items for select
to authenticated
using ((select private.can_view_character_inventory(character_id)));

create policy "dm inserts inventory items"
on public.inventory_items for insert
to authenticated
with check ((select private.can_manage_character_inventory(character_id)));

create policy "dm updates inventory items"
on public.inventory_items for update
to authenticated
using ((select private.can_manage_character_inventory(character_id)))
with check ((select private.can_manage_character_inventory(character_id)));

create policy "dm deletes inventory items"
on public.inventory_items for delete
to authenticated
using ((select private.can_manage_character_inventory(character_id)));

revoke all on table public.character_inventories from anon, authenticated;
grant select on table public.character_inventories to authenticated;
grant update (capacity) on table public.character_inventories to authenticated;
grant select, insert, update, delete on table public.character_inventories to service_role;

revoke all on table public.inventory_items from anon, authenticated;
grant select, insert, update, delete on table public.inventory_items to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-item-images',
  'inventory-item-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "inventory images readable by owner and dm" on storage.objects;
drop policy if exists "inventory images uploaded by dm" on storage.objects;
drop policy if exists "inventory images updated by dm" on storage.objects;
drop policy if exists "inventory images deleted by dm" on storage.objects;

create policy "inventory images readable by owner and dm"
on storage.objects for select
to authenticated
using (
  bucket_id = 'inventory-item-images'
  and (select private.can_view_character_inventory(private.inventory_character_id_from_path(name)))
);

create policy "inventory images uploaded by dm"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'inventory-item-images'
  and (select private.can_manage_character_inventory(private.inventory_character_id_from_path(name)))
);

create policy "inventory images updated by dm"
on storage.objects for update
to authenticated
using (
  bucket_id = 'inventory-item-images'
  and (select private.can_manage_character_inventory(private.inventory_character_id_from_path(name)))
)
with check (
  bucket_id = 'inventory-item-images'
  and (select private.can_manage_character_inventory(private.inventory_character_id_from_path(name)))
);

create policy "inventory images deleted by dm"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'inventory-item-images'
  and (select private.can_manage_character_inventory(private.inventory_character_id_from_path(name)))
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_items'
  ) then
    alter publication supabase_realtime add table public.inventory_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'character_inventories'
  ) then
    alter publication supabase_realtime add table public.character_inventories;
  end if;
end;
$$;

commit;
