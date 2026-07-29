-- Karos D&D Campaign — Pet System Phase 2
-- Pet inventory/equipment, item transfer, release/restore and permanent deletion.

begin;

alter table public.pets
  add column if not exists equipment_slots jsonb not null default '{"head":true,"neck":true,"chest":true,"ring":true,"legs":true,"feet":true,"left_hand":true,"right_hand":true}'::jsonb,
  add column if not exists released_by uuid references public.profiles(id) on delete set null,
  add column if not exists released_at timestamptz,
  add column if not exists release_note text not null default '';

alter table public.pets drop constraint if exists pets_status_check;
alter table public.pets
  add constraint pets_status_check
  check (status in ('pending','revision','approved','rejected','suspended','released'));

alter table public.pets drop constraint if exists pets_equipment_slots_object_check;
alter table public.pets
  add constraint pets_equipment_slots_object_check
  check (jsonb_typeof(equipment_slots) = 'object');

alter table public.pets drop constraint if exists pets_release_note_length_check;
alter table public.pets
  add constraint pets_release_note_length_check
  check (char_length(release_note) <= 2000);

-- Bring the existing character inventory permissions in line with the current
-- campaign Owner/DM role model used by Pet System V1.
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
      from public.characters character
      where character.id = target_character
        and (
          character.owner_id = (select auth.uid())
          or (
            character.campaign_id is not null
            and private.pet_can_manage_campaign(character.campaign_id)
          )
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
      from public.characters character
      where character.id = target_character
        and character.campaign_id is not null
        and private.pet_can_manage_campaign(character.campaign_id)
    );
$$;

create table if not exists public.pet_inventory_items (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  name text not null,
  item_type text not null default 'ไอเทม',
  quantity integer not null default 1 check (quantity >= 1),
  description text not null default '',
  equipped boolean not null default false,
  created_at timestamptz not null default now(),
  category text not null default 'item'
    check (category in ('food','weapon','equipment','item')),
  image_path text,
  slot_index integer not null check (slot_index >= 0),
  allowed_equipment_slot text,
  equipment_slot text,
  updated_at timestamptz not null default now(),
  constraint pet_inventory_items_allowed_slot_check check (
    allowed_equipment_slot is null
    or allowed_equipment_slot in ('head','neck','chest','ring','legs','feet','hand')
  ),
  constraint pet_inventory_items_allowed_category_check check (
    coalesce(
      (category = 'weapon' and allowed_equipment_slot = 'hand')
      or (category = 'equipment' and allowed_equipment_slot in ('head','neck','chest','ring','legs','feet'))
      or (category in ('food','item') and allowed_equipment_slot is null),
      false
    )
  ),
  constraint pet_inventory_items_equipment_slot_check check (
    equipment_slot is null
    or equipment_slot in ('head','neck','chest','ring','legs','feet','left_hand','right_hand')
  ),
  constraint pet_inventory_items_equipment_category_check check (
    coalesce(
      equipment_slot is null
      or (allowed_equipment_slot = 'hand' and equipment_slot in ('left_hand','right_hand'))
      or allowed_equipment_slot = equipment_slot,
      false
    )
  ),
  constraint pet_inventory_items_pet_slot_unique
    unique (pet_id, slot_index) deferrable initially immediate
);

create unique index if not exists pet_inventory_items_pet_equipment_uidx
  on public.pet_inventory_items(pet_id, equipment_slot)
  where equipment_slot is not null;
create index if not exists pet_inventory_items_pet_category_idx
  on public.pet_inventory_items(pet_id, category);

create table if not exists public.pet_image_cleanup_authorizations (
  object_name text not null,
  authorized_user uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day'),
  primary key (object_name, authorized_user)
);
create index if not exists pet_image_cleanup_authorizations_created_idx
  on public.pet_image_cleanup_authorizations(created_at);
create index if not exists pet_image_cleanup_authorizations_user_expiry_idx
  on public.pet_image_cleanup_authorizations(authorized_user, expires_at);

create or replace function private.pet_has_image_cleanup_authorization(target_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pet_image_cleanup_authorizations authorization
    where authorization.object_name = target_object_name
      and authorization.authorized_user = (select auth.uid())
      and authorization.expires_at > now()
  );
$$;

create or replace function private.validate_pet_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capacity_limit integer;
  slot_settings jsonb;
  pet_status text;
  slot_enabled boolean;
begin
  if tg_op = 'UPDATE' and new.pet_id <> old.pet_id then
    raise exception using errcode = '22023', message = 'ไม่สามารถย้ายไอเทมข้ามสัตว์เลี้ยงด้วยการแก้แถวโดยตรง';
  end if;

  select pet.inventory_capacity, pet.equipment_slots, pet.status
  into capacity_limit, slot_settings, pet_status
  from public.pets pet
  where pet.id = new.pet_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  if pet_status not in ('approved','suspended') then
    raise exception using errcode = '22023', message = 'สถานะสัตว์เลี้ยงนี้ไม่สามารถเก็บหรือสวมใส่ไอเทมได้';
  end if;

  if new.slot_index is null then
    select candidate.slot_index
    into new.slot_index
    from generate_series(0, capacity_limit - 1) candidate(slot_index)
    where not exists (
      select 1
      from public.pet_inventory_items existing_item
      where existing_item.pet_id = new.pet_id
        and existing_item.slot_index = candidate.slot_index
        and (tg_op <> 'UPDATE' or existing_item.id <> old.id)
    )
    order by candidate.slot_index
    limit 1;
  end if;

  if new.slot_index is null then
    raise exception using errcode = '22023', message = 'กระเป๋าสัตว์เลี้ยงเต็มแล้ว';
  end if;

  if new.slot_index < 0 or new.slot_index >= capacity_limit then
    raise exception using errcode = '22023', message = 'ตำแหน่งไอเทมอยู่นอกจำนวนช่องของสัตว์เลี้ยง';
  end if;

  if new.equipment_slot is not null then
    slot_enabled := coalesce((slot_settings ->> new.equipment_slot)::boolean, false);

    if not slot_enabled then
      raise exception using errcode = '22023', message = 'DM ปิดตำแหน่งอุปกรณ์นี้ไว้';
    end if;

    if not coalesce(
      (new.allowed_equipment_slot = 'hand' and new.equipment_slot in ('left_hand','right_hand'))
      or new.allowed_equipment_slot = new.equipment_slot,
      false
    ) then
      raise exception using errcode = '22023', message = 'ไอเทมนี้ไม่รองรับตำแหน่งอุปกรณ์ที่เลือก';
    end if;
  end if;

  new.equipped := new.equipment_slot is not null;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.validate_pet_inventory_item() from public, anon, authenticated;

drop trigger if exists pet_inventory_items_validate on public.pet_inventory_items;
create trigger pet_inventory_items_validate
before insert or update on public.pet_inventory_items
for each row execute function private.validate_pet_inventory_item();

alter table public.pet_inventory_items enable row level security;
alter table public.pet_image_cleanup_authorizations enable row level security;

drop policy if exists pet_inventory_items_read on public.pet_inventory_items;
create policy pet_inventory_items_read
on public.pet_inventory_items for select to authenticated
using (private.pet_can_view(pet_id));

revoke all on table public.pet_inventory_items from anon, authenticated;
grant select on table public.pet_inventory_items to authenticated;
grant select, insert, update, delete on table public.pet_inventory_items to service_role;

revoke all on table public.pet_image_cleanup_authorizations from anon, authenticated;
grant select, insert, update, delete on table public.pet_image_cleanup_authorizations to service_role;

create index if not exists pet_inventory_items_image_path_idx
  on public.pet_inventory_items(image_path)
  where image_path is not null;
create index if not exists inventory_items_image_path_idx
  on public.inventory_items(image_path)
  where image_path is not null;

-- An inventory image cannot be removed while either a character item or a pet
-- item still references it.
drop policy if exists "inventory images deleted by owner and dm" on storage.objects;
create policy "inventory images deleted by owner and dm"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'inventory-item-images'
  and (
    select private.can_view_character_inventory(
      private.inventory_character_id_from_path(storage.objects.name)
    )
  )
  and not exists (
    select 1
    from public.inventory_items item
    where item.image_path = storage.objects.name
  )
  and not exists (
    select 1
    from public.pet_inventory_items item
    where item.image_path = storage.objects.name
  )
);

create or replace function public.configure_pet_inventory(
  target_pet uuid,
  target_capacity integer,
  enabled_slots jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item_count integer;
  normalized_slots jsonb;
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่ตั้งค่ากระเป๋าสัตว์เลี้ยงได้';
  end if;

  if target_capacity is null or target_capacity not between 0 and 500 then
    raise exception using errcode = '22023', message = 'จำนวนช่องต้องอยู่ระหว่าง 0 ถึง 500';
  end if;

  perform 1 from public.pets pet where pet.id = target_pet for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  select count(*)::integer
  into item_count
  from public.pet_inventory_items item
  where item.pet_id = target_pet;

  if item_count > target_capacity then
    raise exception using errcode = '22023', message = 'จำนวนช่องใหม่ต่ำกว่าจำนวนกองไอเทมที่มีอยู่';
  end if;

  normalized_slots := jsonb_build_object(
    'head', coalesce((enabled_slots->>'head')::boolean, true),
    'neck', coalesce((enabled_slots->>'neck')::boolean, true),
    'chest', coalesce((enabled_slots->>'chest')::boolean, true),
    'ring', coalesce((enabled_slots->>'ring')::boolean, true),
    'legs', coalesce((enabled_slots->>'legs')::boolean, true),
    'feet', coalesce((enabled_slots->>'feet')::boolean, true),
    'left_hand', coalesce((enabled_slots->>'left_hand')::boolean, true),
    'right_hand', coalesce((enabled_slots->>'right_hand')::boolean, true)
  );

  set constraints public.pet_inventory_items_pet_slot_unique deferred;

  with ranked_items as (
    select item.id,
      row_number() over (order by item.slot_index, item.created_at, item.id)::integer - 1 as next_slot
    from public.pet_inventory_items item
    where item.pet_id = target_pet
  )
  update public.pet_inventory_items item
  set slot_index = ranked_items.next_slot
  from ranked_items
  where item.id = ranked_items.id;

  update public.pet_inventory_items item
  set equipment_slot = null
  where item.pet_id = target_pet
    and item.equipment_slot is not null
    and not coalesce((normalized_slots ->> item.equipment_slot)::boolean, false);

  update public.pets
  set inventory_capacity = target_capacity,
      equipment_slots = normalized_slots
  where id = target_pet;

  return target_pet;
end;
$$;

create or replace function public.move_character_item_to_pet(
  target_item uuid,
  target_pet uuid,
  target_slot integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_item public.inventory_items%rowtype;
  target_character uuid;
  target_status text;
begin
  select pet.character_id, pet.status
  into target_character, target_status
  from public.pets pet
  where pet.id = target_pet;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  if target_status not in ('approved','suspended') then
    raise exception using errcode = '22023', message = 'สถานะสัตว์เลี้ยงนี้ไม่สามารถรับไอเทมได้';
  end if;

  if not (
    private.pet_owns_character(target_character)
    or private.pet_can_manage(target_pet)
  ) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์ย้ายไอเทมให้สัตว์เลี้ยงตัวนี้';
  end if;

  perform 1
  from public.character_inventories inventory
  where inventory.character_id = target_character
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบข้อมูลช่องเก็บของผู้เล่น';
  end if;

  perform 1 from public.pets pet where pet.id = target_pet for update;

  select * into source_item
  from public.inventory_items item
  where item.id = target_item
    and item.character_id = target_character
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบไอเทมในช่องเก็บของผู้เล่น';
  end if;

  insert into public.pet_inventory_items (
    id, pet_id, name, item_type, quantity, description, equipped,
    created_at, category, image_path, slot_index,
    allowed_equipment_slot, equipment_slot, updated_at
  ) values (
    source_item.id,
    target_pet,
    source_item.name,
    source_item.item_type,
    source_item.quantity,
    source_item.description,
    false,
    source_item.created_at,
    source_item.category,
    source_item.image_path,
    target_slot,
    source_item.allowed_equipment_slot,
    null,
    now()
  );

  delete from public.inventory_items where id = source_item.id;
  return source_item.id;
end;
$$;

create or replace function public.move_pet_item_to_character(
  target_item uuid,
  target_slot integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_item public.pet_inventory_items%rowtype;
  source_pet uuid;
  target_character uuid;
  target_status text;
begin
  select item.pet_id into source_pet
  from public.pet_inventory_items item
  where item.id = target_item;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบไอเทมในกระเป๋าสัตว์เลี้ยง';
  end if;

  select pet.character_id, pet.status
  into target_character, target_status
  from public.pets pet
  where pet.id = source_pet;

  if target_status not in ('approved','suspended') then
    raise exception using errcode = '22023', message = 'สถานะสัตว์เลี้ยงนี้ไม่สามารถย้ายไอเทมได้';
  end if;

  if not (
    private.pet_owns_character(target_character)
    or private.pet_can_manage(source_pet)
  ) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์ย้ายไอเทมของสัตว์เลี้ยงตัวนี้';
  end if;

  perform 1
  from public.character_inventories inventory
  where inventory.character_id = target_character
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบข้อมูลช่องเก็บของผู้เล่น';
  end if;

  perform 1 from public.pets pet where pet.id = source_pet for update;

  select * into source_item
  from public.pet_inventory_items item
  where item.id = target_item
    and item.pet_id = source_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบไอเทมในกระเป๋าสัตว์เลี้ยง';
  end if;

  insert into public.inventory_items (
    id, character_id, name, item_type, quantity, description, equipped,
    created_at, category, image_path, slot_index,
    allowed_equipment_slot, equipment_slot, updated_at
  ) values (
    source_item.id,
    target_character,
    source_item.name,
    source_item.item_type,
    source_item.quantity,
    source_item.description,
    false,
    source_item.created_at,
    source_item.category,
    source_item.image_path,
    target_slot,
    source_item.allowed_equipment_slot,
    null,
    now()
  );

  delete from public.pet_inventory_items where id = source_item.id;
  return source_item.id;
end;
$$;

create or replace function public.equip_pet_item(
  target_item uuid,
  target_slot text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_pet uuid;
  target_character uuid;
  target_status text;
  target_allowed_slot text;
  slot_settings jsonb;
begin
  select item.pet_id
  into target_pet
  from public.pet_inventory_items item
  where item.id = target_item;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบไอเทมสัตว์เลี้ยง';
  end if;

  select pet.character_id, pet.status, pet.equipment_slots
  into target_character, target_status, slot_settings
  from public.pets pet
  where pet.id = target_pet
  for update;

  if target_status not in ('approved','suspended') then
    raise exception using errcode = '22023', message = 'สถานะสัตว์เลี้ยงนี้ไม่สามารถสวมใส่อุปกรณ์ได้';
  end if;

  if not (
    private.pet_owns_character(target_character)
    or private.pet_can_manage(target_pet)
  ) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์สวมใส่อุปกรณ์ให้สัตว์เลี้ยงตัวนี้';
  end if;

  if target_slot not in ('head','neck','chest','ring','legs','feet','left_hand','right_hand') then
    raise exception using errcode = '22023', message = 'ตำแหน่งอุปกรณ์ไม่ถูกต้อง';
  end if;

  if not coalesce((slot_settings ->> target_slot)::boolean, false) then
    raise exception using errcode = '22023', message = 'DM ปิดตำแหน่งอุปกรณ์นี้ไว้';
  end if;

  select item.allowed_equipment_slot
  into target_allowed_slot
  from public.pet_inventory_items item
  where item.id = target_item
    and item.pet_id = target_pet
  for update;

  if not coalesce(
    (target_allowed_slot = 'hand' and target_slot in ('left_hand','right_hand'))
    or target_allowed_slot = target_slot,
    false
  ) then
    raise exception using errcode = '22023', message = 'ไอเทมนี้ไม่รองรับตำแหน่งที่เลือก';
  end if;

  update public.pet_inventory_items
  set equipment_slot = null
  where pet_id = target_pet
    and equipment_slot = target_slot
    and id <> target_item;

  update public.pet_inventory_items
  set equipment_slot = target_slot
  where id = target_item;

  return target_item;
end;
$$;

create or replace function public.unequip_pet_item(target_item uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_pet uuid;
  target_character uuid;
begin
  select item.pet_id
  into target_pet
  from public.pet_inventory_items item
  where item.id = target_item;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบไอเทมสัตว์เลี้ยง';
  end if;

  select pet.character_id
  into target_character
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not (
    private.pet_owns_character(target_character)
    or private.pet_can_manage(target_pet)
  ) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์ถอดอุปกรณ์ของสัตว์เลี้ยงตัวนี้';
  end if;

  update public.pet_inventory_items
  set equipment_slot = null
  where id = target_item;

  return target_item;
end;
$$;

create or replace function public.release_pet(
  target_pet uuid,
  confirmation_name text,
  note text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_character uuid;
  current_name text;
  current_status text;
  item_count integer;
begin
  select pet.character_id, pet.name, pet.status
  into target_character, current_name, current_status
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  if not private.pet_owns_character(target_character) then
    raise exception using errcode = '42501', message = 'เฉพาะเจ้าของสัตว์เลี้ยงเท่านั้นที่ปล่อยสัตว์เลี้ยงได้';
  end if;

  if current_status not in ('approved','suspended') then
    raise exception using errcode = '22023', message = 'สถานะปัจจุบันไม่สามารถปล่อยสัตว์เลี้ยงได้';
  end if;

  if confirmation_name is distinct from current_name then
    raise exception using errcode = '22023', message = 'ชื่อยืนยันไม่ตรงกับชื่อสัตว์เลี้ยง';
  end if;

  select count(*)::integer into item_count
  from public.pet_inventory_items item
  where item.pet_id = target_pet;

  if item_count > 0 then
    raise exception using errcode = '22023', message = 'ต้องย้ายไอเทมออกจากสัตว์เลี้ยงให้หมดก่อนปล่อย';
  end if;

  update public.pets
  set status = 'released',
      is_active = false,
      released_by = (select auth.uid()),
      released_at = now(),
      release_note = left(trim(coalesce(note, '')), 2000)
  where id = target_pet;

  return target_pet;
end;
$$;

create or replace function public.restore_released_pet(
  target_pet uuid,
  note text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_character uuid;
  current_status text;
  maximum_pets integer;
  occupied_slots integer;
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่กู้คืนสัตว์เลี้ยงได้';
  end if;

  select pet.character_id, pet.status
  into target_character, current_status
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found or current_status <> 'released' then
    raise exception using errcode = '22023', message = 'กู้คืนได้เฉพาะสัตว์เลี้ยงที่ถูกปล่อยแล้ว';
  end if;

  insert into public.character_pet_settings(character_id)
  values (target_character)
  on conflict (character_id) do nothing;

  select settings.max_pets
  into maximum_pets
  from public.character_pet_settings settings
  where settings.character_id = target_character
  for update;

  select count(*)::integer
  into occupied_slots
  from public.pets pet
  where pet.character_id = target_character
    and pet.status not in ('rejected','released')
    and pet.id <> target_pet;

  if occupied_slots >= maximum_pets then
    raise exception using errcode = '22023', message = 'จำนวนสัตว์เลี้ยงเต็มแล้ว ไม่สามารถกู้คืนได้';
  end if;

  update public.pets
  set status = 'approved',
      is_active = false,
      release_note = '',
      released_by = null,
      released_at = null,
      approval_note = left(trim(coalesce(note, '')), 2000)
  where id = target_pet;

  return target_pet;
end;
$$;

create or replace function public.delete_pet_permanently(
  target_pet uuid,
  confirmation_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_name text;
  current_status text;
  item_count integer;
  image_paths jsonb;
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่ลบสัตว์เลี้ยงถาวรได้';
  end if;

  select pet.name, pet.status
  into current_name, current_status
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  if current_status not in ('released','rejected') then
    raise exception using errcode = '22023', message = 'ต้องปล่อยหรือปฏิเสธสัตว์เลี้ยงก่อนลบถาวร';
  end if;

  if confirmation_name is distinct from current_name then
    raise exception using errcode = '22023', message = 'ชื่อยืนยันไม่ตรงกับชื่อสัตว์เลี้ยง';
  end if;

  select count(*)::integer into item_count
  from public.pet_inventory_items item
  where item.pet_id = target_pet;

  if item_count > 0 then
    raise exception using errcode = '22023', message = 'ต้องย้ายไอเทมออกจากสัตว์เลี้ยงให้หมดก่อนลบ';
  end if;

  select coalesce(
    jsonb_agg(image.image_path order by image.first_created_at, image.image_path),
    '[]'::jsonb
  )
  into image_paths
  from (
    select form.image_path, min(form.created_at) as first_created_at
    from public.pet_forms form
    where form.pet_id = target_pet
      and trim(form.image_path) <> ''
    group by form.image_path
  ) image;

  insert into public.pet_image_cleanup_authorizations(object_name, authorized_user)
  select distinct form.image_path, (select auth.uid())
  from public.pet_forms form
  where form.pet_id = target_pet
    and trim(form.image_path) <> ''
  on conflict (object_name, authorized_user) do update
  set created_at = now(),
      expires_at = now() + interval '1 day';

  delete from public.pets where id = target_pet;
  return image_paths;
end;
$$;

create or replace function public.complete_pet_image_cleanup(object_names text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบ';
  end if;

  delete from public.pet_image_cleanup_authorizations authorization
  where authorization.authorized_user = (select auth.uid())
    and authorization.object_name = any(coalesce(object_names, array[]::text[]));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.get_pending_pet_image_cleanup()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(authorization.object_name order by authorization.object_name),
    array[]::text[]
  )
  from public.pet_image_cleanup_authorizations authorization
  where authorization.authorized_user = (select auth.uid())
    and authorization.expires_at > now();
$$;

-- Released pets no longer consume the per-character pet limit.
create or replace function public.create_pet_request(
  requested_pet_id uuid,
  requested_form_id uuid,
  target_character uuid,
  pet_name text,
  pet_title text,
  requested_pet_type text,
  requested_species text,
  pet_description text,
  starting_form_name text,
  starting_image_path text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_campaign uuid;
  maximum_pets integer;
  occupied_slots integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบ';
  end if;

  if not private.pet_owns_character(target_character) then
    raise exception using errcode = '42501', message = 'เฉพาะเจ้าของตัวละครเท่านั้นที่ส่งคำขอสัตว์เลี้ยงได้';
  end if;

  select character.campaign_id
  into target_campaign
  from public.characters character
  where character.id = target_character;

  if target_campaign is null then
    raise exception using errcode = '22023', message = 'ตัวละครต้องอยู่ในแคมเปญก่อนสร้างสัตว์เลี้ยง';
  end if;

  insert into public.character_pet_settings(character_id)
  values (target_character)
  on conflict (character_id) do nothing;

  select settings.max_pets
  into maximum_pets
  from public.character_pet_settings settings
  where settings.character_id = target_character
  for update;

  select count(*)::integer
  into occupied_slots
  from public.pets pet
  where pet.character_id = target_character
    and pet.status not in ('rejected','released');

  if occupied_slots >= maximum_pets then
    raise exception using
      errcode = '22023',
      message = format('จำนวนสัตว์เลี้ยงเต็มแล้ว (%s/%s)', occupied_slots, maximum_pets);
  end if;

  if trim(coalesce(pet_name, '')) = '' then
    raise exception using errcode = '22023', message = 'กรุณาตั้งชื่อสัตว์เลี้ยง';
  end if;

  if trim(coalesce(starting_image_path, '')) = ''
    or starting_image_path not like ((select auth.uid())::text || '/' || requested_pet_id::text || '/%')
  then
    raise exception using errcode = '22023', message = 'ตำแหน่งรูปสัตว์เลี้ยงไม่ถูกต้อง';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'pet-images'
      and object.name = starting_image_path
  ) then
    raise exception using errcode = 'P0002', message = 'ไม่พบไฟล์รูปสัตว์เลี้ยงที่อัปโหลด';
  end if;

  insert into public.pets (
    id, character_id, campaign_id, created_by, name, title,
    pet_type, species, description, status
  ) values (
    requested_pet_id,
    target_character,
    target_campaign,
    (select auth.uid()),
    left(trim(pet_name), 120),
    left(trim(coalesce(pet_title, '')), 120),
    left(coalesce(nullif(trim(requested_pet_type), ''), 'สัตว์บก'), 80),
    left(trim(coalesce(requested_species, '')), 120),
    left(trim(coalesce(pet_description, '')), 4000),
    'pending'
  );

  insert into public.pet_forms (
    id, pet_id, name, description, image_path,
    relationship_required, pet_type, is_starting, created_by
  ) values (
    requested_form_id,
    requested_pet_id,
    left(coalesce(nullif(trim(starting_form_name), ''), trim(pet_name) || ' · ร่างเริ่มต้น'), 120),
    left(trim(coalesce(pet_description, '')), 4000),
    starting_image_path,
    0,
    left(coalesce(nullif(trim(requested_pet_type), ''), 'สัตว์บก'), 80),
    true,
    (select auth.uid())
  );

  return requested_pet_id;
end;
$$;

revoke all on function private.pet_has_image_cleanup_authorization(text) from public, anon;
grant execute on function private.pet_has_image_cleanup_authorization(text) to authenticated;

revoke all on function public.configure_pet_inventory(uuid, integer, jsonb) from public, anon;
revoke all on function public.move_character_item_to_pet(uuid, uuid, integer) from public, anon;
revoke all on function public.move_pet_item_to_character(uuid, integer) from public, anon;
revoke all on function public.equip_pet_item(uuid, text) from public, anon;
revoke all on function public.unequip_pet_item(uuid) from public, anon;
revoke all on function public.release_pet(uuid, text, text) from public, anon;
revoke all on function public.restore_released_pet(uuid, text) from public, anon;
revoke all on function public.delete_pet_permanently(uuid, text) from public, anon;
revoke all on function public.complete_pet_image_cleanup(text[]) from public, anon;
revoke all on function public.get_pending_pet_image_cleanup() from public, anon;

grant execute on function public.configure_pet_inventory(uuid, integer, jsonb) to authenticated;
grant execute on function public.move_character_item_to_pet(uuid, uuid, integer) to authenticated;
grant execute on function public.move_pet_item_to_character(uuid, integer) to authenticated;
grant execute on function public.equip_pet_item(uuid, text) to authenticated;
grant execute on function public.unequip_pet_item(uuid) to authenticated;
grant execute on function public.release_pet(uuid, text, text) to authenticated;
grant execute on function public.restore_released_pet(uuid, text) to authenticated;
grant execute on function public.delete_pet_permanently(uuid, text) to authenticated;
grant execute on function public.complete_pet_image_cleanup(text[]) to authenticated;
grant execute on function public.get_pending_pet_image_cleanup() to authenticated;

-- Keep existing pet image deletion rules and add one-time DM cleanup authorization
-- for images belonging to a pet that has already been deleted from public.pets.
drop policy if exists pet_images_delete on storage.objects;
create policy pet_images_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'pet-images'
  and (
    private.pet_can_manage(private.pet_storage_pet_id(name))
    or private.pet_storage_can_cleanup(name)
    or private.pet_has_image_cleanup_authorization(name)
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pet_inventory_items'
  ) then
    alter publication supabase_realtime add table public.pet_inventory_items;
  end if;
end;
$$;

comment on table public.pet_inventory_items is 'Inventory stacks stored by a pet. Items move transactionally between this table and inventory_items.';
comment on function public.release_pet(uuid, text, text) is 'Owner soft-release. Requires an empty pet inventory and preserves pet history for DM restoration.';
comment on function public.delete_pet_permanently(uuid, text) is 'DM-only permanent deletion for released or rejected pets. Returns authorized storage paths for cleanup.';

commit;
