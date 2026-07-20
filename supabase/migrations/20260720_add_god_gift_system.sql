alter table public.god_vault_grants
  add column if not exists notify_player boolean not null default true;

create table if not exists public.god_gift_notifications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  recipient_character_id uuid not null references public.characters(id) on delete cascade,
  grant_id uuid not null unique references public.god_vault_grants(id) on delete cascade,
  title text not null default 'ของขวัญจากพระเจ้า',
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists god_gift_notifications_recipient_created_idx
  on public.god_gift_notifications(recipient_character_id, created_at desc);

create index if not exists god_gift_notifications_unread_idx
  on public.god_gift_notifications(recipient_character_id, created_at desc)
  where read_at is null;

alter table public.god_gift_notifications enable row level security;

drop policy if exists "character owner views god gift notifications"
  on public.god_gift_notifications;
create policy "character owner views god gift notifications"
on public.god_gift_notifications
for select
using (
  exists (
    select 1
    from public.characters c
    where c.id = recipient_character_id
      and c.owner_id = auth.uid()
  )
);

drop policy if exists "character owner marks god gift notifications"
  on public.god_gift_notifications;
create policy "character owner marks god gift notifications"
on public.god_gift_notifications
for update
using (
  exists (
    select 1
    from public.characters c
    where c.id = recipient_character_id
      and c.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.characters c
    where c.id = recipient_character_id
      and c.owner_id = auth.uid()
  )
);

-- Correct the character/campaign comparison in the original history policy.
drop policy if exists "campaign staff create god vault grants"
  on public.god_vault_grants;
create policy "campaign staff create god vault grants"
on public.god_vault_grants
for insert
with check (
  public.is_campaign_dm(campaign_id)
  and granted_by = auth.uid()
  and exists (
    select 1
    from public.characters target
    where target.id = character_id
      and target.campaign_id = god_vault_grants.campaign_id
  )
);

create or replace function public.grant_god_vault_gift(
  target_campaign uuid,
  target_vault_item uuid,
  target_character uuid,
  target_inventory_item uuid,
  gift_name text,
  gift_item_type text,
  gift_category text,
  gift_quantity integer,
  gift_description text,
  gift_image_path text,
  gift_allowed_equipment_slot text,
  gift_note text,
  show_notification boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  vault_row public.god_vault_items%rowtype;
  character_row public.characters%rowtype;
  capacity_limit integer;
  destination_slot integer;
  grant_id uuid;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนมอบของ';
  end if;

  if not public.is_campaign_dm(target_campaign) then
    raise exception 'เฉพาะ Owner หรือ DM เท่านั้นที่มอบของจากคลังพระเจ้าได้';
  end if;

  if gift_quantity is null or gift_quantity < 1 then
    raise exception 'จำนวนของขวัญต้องอย่างน้อย 1';
  end if;

  if gift_category not in ('food', 'weapon', 'equipment', 'item') then
    raise exception 'ประเภทไอเทมไม่ถูกต้อง';
  end if;

  if gift_name is null or btrim(gift_name) = '' then
    raise exception 'กรุณาระบุชื่อของขวัญ';
  end if;

  select * into vault_row
  from public.god_vault_items
  where id = target_vault_item
    and campaign_id = target_campaign
    and deleted_at is null;

  if vault_row.id is null then
    raise exception 'ไม่พบของต้นฉบับในคลังพระเจ้า';
  end if;

  select * into character_row
  from public.characters
  where id = target_character
    and campaign_id = target_campaign;

  if character_row.id is null then
    raise exception 'ตัวละครผู้รับไม่ได้อยู่ในแคมเปญนี้';
  end if;

  if gift_image_path is not null and (
    split_part(gift_image_path, '/', 1) <> target_character::text
    or split_part(gift_image_path, '/', 2) <> target_inventory_item::text
  ) then
    raise exception 'ที่อยู่รูปของขวัญไม่ตรงกับตัวละครหรือไอเทมปลายทาง';
  end if;

  insert into public.character_inventories (character_id)
  values (target_character)
  on conflict (character_id) do nothing;

  select capacity into capacity_limit
  from public.character_inventories
  where character_id = target_character
  for update;

  select slot_value into destination_slot
  from generate_series(0, capacity_limit - 1) as gs(slot_value)
  where not exists (
    select 1
    from public.inventory_items current_item
    where current_item.character_id = target_character
      and current_item.slot_index = slot_value
  )
  order by slot_value
  limit 1;

  if destination_slot is null then
    raise exception 'ช่องเก็บของของผู้รับเต็มแล้ว';
  end if;

  insert into public.inventory_items (
    id,
    character_id,
    name,
    item_type,
    category,
    quantity,
    description,
    image_path,
    slot_index,
    allowed_equipment_slot,
    equipment_slot,
    equipped
  )
  values (
    target_inventory_item,
    target_character,
    btrim(gift_name),
    coalesce(nullif(btrim(gift_item_type), ''), 'ไอเทม'),
    gift_category,
    gift_quantity,
    coalesce(gift_description, ''),
    gift_image_path,
    destination_slot,
    case
      when gift_category in ('weapon', 'equipment')
        then nullif(btrim(gift_allowed_equipment_slot), '')
      else null
    end,
    null,
    false
  );

  insert into public.god_vault_grants (
    campaign_id,
    vault_item_id,
    inventory_item_id,
    character_id,
    granted_by,
    quantity,
    item_name,
    item_type,
    inventory_category,
    note,
    notify_player,
    source_snapshot
  )
  values (
    target_campaign,
    target_vault_item,
    target_inventory_item,
    target_character,
    auth.uid(),
    gift_quantity,
    btrim(gift_name),
    coalesce(nullif(btrim(gift_item_type), ''), 'ไอเทม'),
    gift_category,
    coalesce(gift_note, ''),
    show_notification,
    jsonb_build_object(
      'vault_item_name', vault_row.name,
      'vault_image_path', vault_row.image_path,
      'inventory_image_path', gift_image_path,
      'description', gift_description,
      'allowed_equipment_slot', gift_allowed_equipment_slot
    )
  )
  returning id into grant_id;

  if show_notification then
    insert into public.god_gift_notifications (
      campaign_id,
      recipient_character_id,
      grant_id,
      title,
      body,
      payload
    )
    values (
      target_campaign,
      target_character,
      grant_id,
      'ของขวัญจากพระเจ้า',
      '“' || btrim(gift_name) || '” จำนวน ' || gift_quantity ||
        ' ถูกประทานเข้าสู่คลังของ ' || character_row.name,
      jsonb_build_object(
        'item_name', btrim(gift_name),
        'quantity', gift_quantity,
        'character_name', character_row.name,
        'inventory_item_id', target_inventory_item,
        'image_path', gift_image_path,
        'note', coalesce(gift_note, '')
      )
    );
  end if;

  return grant_id;
end;
$function$;

revoke all on function public.grant_god_vault_gift(
  uuid, uuid, uuid, uuid, text, text, text, integer, text, text, text, text, boolean
) from public;

grant execute on function public.grant_god_vault_gift(
  uuid, uuid, uuid, uuid, text, text, text, integer, text, text, text, text, boolean
) to authenticated;

do $publication$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'god_gift_notifications'
  ) then
    alter publication supabase_realtime
      add table public.god_gift_notifications;
  end if;
end;
$publication$;
