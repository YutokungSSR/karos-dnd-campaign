
-- Character-to-character exchange, direct item stuffing, money transfer,
-- realtime notifications, and trade-safe inventory image access.

create or replace function private.can_control_exchange_character(target_character uuid)
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
      where c.id = target_character
        and (
          c.owner_id = (select auth.uid())
          or (
            c.campaign_id is not null
            and public.is_campaign_dm(c.campaign_id)
          )
        )
    );
$$;

revoke all on function private.can_control_exchange_character(uuid) from public;
grant execute on function private.can_control_exchange_character(uuid) to authenticated;

create table if not exists public.character_trades (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  initiator_character_id uuid not null references public.characters(id) on delete cascade,
  recipient_character_id uuid not null references public.characters(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'cancelled', 'rejected')),
  initiator_ready boolean not null default false,
  recipient_ready boolean not null default false,
  initiator_temma bigint not null default 0 check (initiator_temma >= 0),
  recipient_temma bigint not null default 0 check (recipient_temma >= 0),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (initiator_character_id <> recipient_character_id)
);

create index if not exists character_trades_campaign_status_idx
  on public.character_trades(campaign_id, status, updated_at desc);
create index if not exists character_trades_initiator_idx
  on public.character_trades(initiator_character_id, status, updated_at desc);
create index if not exists character_trades_recipient_idx
  on public.character_trades(recipient_character_id, status, updated_at desc);

create table if not exists public.character_trade_items (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.character_trades(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  quantity integer not null check (quantity > 0),
  item_name text not null,
  item_type text not null,
  category text not null
    check (category in ('food', 'weapon', 'equipment', 'item')),
  description text not null default '',
  image_path text,
  allowed_equipment_slot text,
  created_at timestamptz not null default now(),
  unique (trade_id, character_id, inventory_item_id)
);

create index if not exists character_trade_items_trade_idx
  on public.character_trade_items(trade_id, character_id);

create table if not exists public.character_exchange_notifications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  recipient_character_id uuid not null references public.characters(id) on delete cascade,
  sender_character_id uuid references public.characters(id) on delete set null,
  trade_id uuid references public.character_trades(id) on delete cascade,
  kind text not null check (
    kind in (
      'trade_invite',
      'trade_accepted',
      'trade_rejected',
      'trade_cancelled',
      'trade_completed',
      'forced_item',
      'money_transfer'
    )
  ),
  tone text not null default 'gold'
    check (tone in ('gold', 'red', 'green', 'blue', 'rainbow')),
  title text not null,
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists character_exchange_notifications_recipient_idx
  on public.character_exchange_notifications(recipient_character_id, created_at desc);
create index if not exists character_exchange_notifications_unread_idx
  on public.character_exchange_notifications(recipient_character_id, read_at)
  where read_at is null;

create or replace function private.can_access_character_trade(target_trade uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.character_trades t
    where t.id = target_trade
      and (
        private.can_control_exchange_character(t.initiator_character_id)
        or private.can_control_exchange_character(t.recipient_character_id)
      )
  );
$$;

revoke all on function private.can_access_character_trade(uuid) from public;
grant execute on function private.can_access_character_trade(uuid) to authenticated;

alter table public.character_trades enable row level security;
alter table public.character_trade_items enable row level security;
alter table public.character_exchange_notifications enable row level security;

drop policy if exists "trade participants view trades" on public.character_trades;
create policy "trade participants view trades"
on public.character_trades
for select
using (private.can_access_character_trade(id));

drop policy if exists "trade participants view offered items" on public.character_trade_items;
create policy "trade participants view offered items"
on public.character_trade_items
for select
using (private.can_access_character_trade(trade_id));

drop policy if exists "character controller views exchange notifications"
  on public.character_exchange_notifications;
create policy "character controller views exchange notifications"
on public.character_exchange_notifications
for select
using (private.can_control_exchange_character(recipient_character_id));

drop policy if exists "character controller marks exchange notifications"
  on public.character_exchange_notifications;
create policy "character controller marks exchange notifications"
on public.character_exchange_notifications
for update
using (private.can_control_exchange_character(recipient_character_id))
with check (private.can_control_exchange_character(recipient_character_id));

-- A transferred item may retain the original private Storage path.
-- The current controller of any item referencing that path can still read it.
drop policy if exists "inventory images readable through transferred item"
  on storage.objects;
create policy "inventory images readable through transferred item"
on storage.objects
for select
using (
  bucket_id = 'inventory-item-images'
  and exists (
    select 1
    from public.inventory_items i
    where i.image_path = storage.objects.name
      and private.can_control_exchange_character(i.character_id)
  )
);

create or replace function public.create_character_trade(
  source_character uuid,
  target_character uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.characters%rowtype;
  target_row public.characters%rowtype;
  trade_id uuid;
begin
  if source_character = target_character then
    raise exception 'ไม่สามารถเทรดกับตัวละครเดียวกันได้';
  end if;

  select * into source_row
  from public.characters
  where id = source_character;

  select * into target_row
  from public.characters
  where id = target_character;

  if source_row.id is null or target_row.id is null then
    raise exception 'ไม่พบตัวละครต้นทางหรือปลายทาง';
  end if;

  if source_row.campaign_id is null
     or source_row.campaign_id is distinct from target_row.campaign_id then
    raise exception 'ตัวละครต้องอยู่ในแคมเปญเดียวกัน';
  end if;

  if not private.can_control_exchange_character(source_character) then
    raise exception 'คุณไม่มีสิทธิ์ควบคุมตัวละครผู้เริ่มเทรด';
  end if;

  if exists (
    select 1
    from public.character_trades t
    where t.status in ('pending', 'active')
      and (
        t.initiator_character_id in (source_character, target_character)
        or t.recipient_character_id in (source_character, target_character)
      )
  ) then
    raise exception 'ตัวละครฝ่ายใดฝ่ายหนึ่งกำลังอยู่ในการเทรดอื่น';
  end if;

  insert into public.character_trades (
    campaign_id,
    initiator_character_id,
    recipient_character_id,
    created_by,
    status
  )
  values (
    source_row.campaign_id,
    source_character,
    target_character,
    auth.uid(),
    'pending'
  )
  returning id into trade_id;

  insert into public.character_exchange_notifications (
    campaign_id,
    recipient_character_id,
    sender_character_id,
    trade_id,
    kind,
    tone,
    title,
    body,
    payload
  )
  values (
    source_row.campaign_id,
    target_character,
    source_character,
    trade_id,
    'trade_invite',
    'gold',
    'คำเชิญแลกเปลี่ยน',
    source_row.name || ' ต้องการเปิดหน้าต่างแลกเปลี่ยนกับคุณ',
    jsonb_build_object(
      'sender_name', source_row.name,
      'recipient_name', target_row.name
    )
  );

  return trade_id;
end;
$$;

create or replace function public.respond_character_trade(
  target_trade uuid,
  acting_character uuid,
  accept_trade boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade_row public.character_trades%rowtype;
  initiator_name text;
  recipient_name text;
begin
  select * into trade_row
  from public.character_trades
  where id = target_trade
  for update;

  if trade_row.id is null then
    raise exception 'ไม่พบคำเชิญเทรด';
  end if;

  if trade_row.status <> 'pending' then
    raise exception 'คำเชิญนี้ไม่ได้อยู่ในสถานะรอคำตอบ';
  end if;

  if trade_row.recipient_character_id <> acting_character
     or not private.can_control_exchange_character(acting_character) then
    raise exception 'เฉพาะตัวละครผู้รับคำเชิญเท่านั้นที่ตอบได้';
  end if;

  select name into initiator_name
  from public.characters
  where id = trade_row.initiator_character_id;

  select name into recipient_name
  from public.characters
  where id = trade_row.recipient_character_id;

  if accept_trade then
    update public.character_trades
    set status = 'active',
        updated_at = now(),
        revision = revision + 1
    where id = target_trade;

    insert into public.character_exchange_notifications (
      campaign_id,
      recipient_character_id,
      sender_character_id,
      trade_id,
      kind,
      tone,
      title,
      body
    )
    values (
      trade_row.campaign_id,
      trade_row.initiator_character_id,
      trade_row.recipient_character_id,
      target_trade,
      'trade_accepted',
      'green',
      'เริ่มการแลกเปลี่ยนแล้ว',
      recipient_name || ' ยอมรับคำเชิญของ ' || initiator_name
    );

    return 'active';
  end if;

  update public.character_trades
  set status = 'rejected',
      updated_at = now()
  where id = target_trade;

  insert into public.character_exchange_notifications (
    campaign_id,
    recipient_character_id,
    sender_character_id,
    trade_id,
    kind,
    tone,
    title,
    body
  )
  values (
    trade_row.campaign_id,
    trade_row.initiator_character_id,
    trade_row.recipient_character_id,
    target_trade,
    'trade_rejected',
    'red',
    'คำเชิญถูกปฏิเสธ',
    recipient_name || ' ปฏิเสธการแลกเปลี่ยน'
  );

  return 'rejected';
end;
$$;

create or replace function public.cancel_character_trade(
  target_trade uuid,
  acting_character uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade_row public.character_trades%rowtype;
  other_character uuid;
  actor_name text;
begin
  select * into trade_row
  from public.character_trades
  where id = target_trade
  for update;

  if trade_row.id is null then
    raise exception 'ไม่พบการเทรด';
  end if;

  if trade_row.status not in ('pending', 'active') then
    raise exception 'การเทรดนี้สิ้นสุดแล้ว';
  end if;

  if acting_character not in (
    trade_row.initiator_character_id,
    trade_row.recipient_character_id
  ) or not private.can_control_exchange_character(acting_character) then
    raise exception 'คุณไม่มีสิทธิ์ยกเลิกการเทรดนี้';
  end if;

  other_character := case
    when acting_character = trade_row.initiator_character_id
      then trade_row.recipient_character_id
    else trade_row.initiator_character_id
  end;

  select name into actor_name
  from public.characters
  where id = acting_character;

  update public.character_trades
  set status = 'cancelled',
      updated_at = now()
  where id = target_trade;

  insert into public.character_exchange_notifications (
    campaign_id,
    recipient_character_id,
    sender_character_id,
    trade_id,
    kind,
    tone,
    title,
    body
  )
  values (
    trade_row.campaign_id,
    other_character,
    acting_character,
    target_trade,
    'trade_cancelled',
    'red',
    'การแลกเปลี่ยนถูกยกเลิก',
    actor_name || ' ยกเลิกหน้าต่างแลกเปลี่ยน'
  );
end;
$$;

create or replace function public.set_character_trade_offer(
  target_trade uuid,
  acting_character uuid,
  offered_items jsonb,
  offered_temma bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade_row public.character_trades%rowtype;
  entry jsonb;
  item_id uuid;
  item_quantity integer;
  item_row public.inventory_items%rowtype;
  balance_value bigint;
begin
  if offered_temma < 0 then
    raise exception 'จำนวนเงินที่เสนอห้ามติดลบ';
  end if;

  if jsonb_typeof(coalesce(offered_items, '[]'::jsonb)) <> 'array' then
    raise exception 'รูปแบบรายการไอเทมไม่ถูกต้อง';
  end if;

  select * into trade_row
  from public.character_trades
  where id = target_trade
  for update;

  if trade_row.id is null or trade_row.status <> 'active' then
    raise exception 'หน้าต่างเทรดนี้ไม่ได้เปิดใช้งาน';
  end if;

  if acting_character not in (
    trade_row.initiator_character_id,
    trade_row.recipient_character_id
  ) or not private.can_control_exchange_character(acting_character) then
    raise exception 'คุณไม่มีสิทธิ์แก้ข้อเสนอของตัวละครนี้';
  end if;

  insert into public.character_inventories (character_id)
  values (acting_character)
  on conflict (character_id) do nothing;

  select temma_balance into balance_value
  from public.character_inventories
  where character_id = acting_character
  for update;

  if offered_temma > balance_value then
    raise exception 'เงินเทมมาไม่เพียงพอ';
  end if;

  delete from public.character_trade_items
  where trade_id = target_trade
    and character_id = acting_character;

  for entry in
    select value
    from jsonb_array_elements(coalesce(offered_items, '[]'::jsonb))
  loop
    begin
      item_id := (entry ->> 'item_id')::uuid;
      item_quantity := (entry ->> 'quantity')::integer;
    exception when others then
      raise exception 'ข้อมูลไอเทมในข้อเสนอไม่ถูกต้อง';
    end;

    if item_quantity is null or item_quantity < 1 then
      raise exception 'จำนวนไอเทมที่เสนออย่างน้อย 1 ชิ้น';
    end if;

    select * into item_row
    from public.inventory_items
    where id = item_id
      and character_id = acting_character
    for update;

    if item_row.id is null then
      raise exception 'ไม่พบไอเทมที่เลือกในคลังของตัวละคร';
    end if;

    if item_row.equipped or item_row.equipment_slot is not null then
      raise exception 'ต้องถอด % ออกจากช่องสวมใส่ก่อน', item_row.name;
    end if;

    if item_quantity > item_row.quantity then
      raise exception 'จำนวน % ในคลังไม่เพียงพอ', item_row.name;
    end if;

    insert into public.character_trade_items (
      trade_id,
      character_id,
      inventory_item_id,
      quantity,
      item_name,
      item_type,
      category,
      description,
      image_path,
      allowed_equipment_slot
    )
    values (
      target_trade,
      acting_character,
      item_row.id,
      item_quantity,
      item_row.name,
      item_row.item_type,
      item_row.category,
      item_row.description,
      item_row.image_path,
      item_row.allowed_equipment_slot
    );
  end loop;

  update public.character_trades
  set initiator_temma = case
        when acting_character = initiator_character_id
          then offered_temma
        else initiator_temma
      end,
      recipient_temma = case
        when acting_character = recipient_character_id
          then offered_temma
        else recipient_temma
      end,
      initiator_ready = false,
      recipient_ready = false,
      revision = revision + 1,
      updated_at = now()
  where id = target_trade;
end;
$$;

create or replace function private.finalize_character_trade(target_trade uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade_row public.character_trades%rowtype;
  offer_row record;
  current_item public.inventory_items%rowtype;
  initiator_capacity integer;
  recipient_capacity integer;
  initiator_count integer;
  recipient_count integer;
  initiator_out_full integer;
  recipient_out_full integer;
  initiator_incoming integer;
  recipient_incoming integer;
  destination_character uuid;
  destination_capacity integer;
  destination_slot integer;
  initiator_name text;
  recipient_name text;
begin
  select * into trade_row
  from public.character_trades
  where id = target_trade
  for update;

  if trade_row.id is null
     or trade_row.status <> 'active'
     or not trade_row.initiator_ready
     or not trade_row.recipient_ready then
    raise exception 'การเทรดยังไม่พร้อมดำเนินการ';
  end if;

  insert into public.character_inventories (character_id)
  values (trade_row.initiator_character_id)
  on conflict (character_id) do nothing;

  insert into public.character_inventories (character_id)
  values (trade_row.recipient_character_id)
  on conflict (character_id) do nothing;

  perform 1
  from public.character_inventories
  where character_id in (
    trade_row.initiator_character_id,
    trade_row.recipient_character_id
  )
  order by character_id
  for update;

  perform 1
  from public.inventory_items i
  where i.id in (
    select ti.inventory_item_id
    from public.character_trade_items ti
    where ti.trade_id = target_trade
  )
  order by i.id
  for update;

  for offer_row in
    select ti.*
    from public.character_trade_items ti
    where ti.trade_id = target_trade
    order by ti.id
  loop
    select * into current_item
    from public.inventory_items
    where id = offer_row.inventory_item_id
      and character_id = offer_row.character_id;

    if current_item.id is null then
      raise exception 'ไอเทม % ไม่อยู่ในคลังเดิมแล้ว', offer_row.item_name;
    end if;

    if current_item.equipped or current_item.equipment_slot is not null then
      raise exception 'ต้องถอด % ออกจากช่องสวมใส่ก่อน', current_item.name;
    end if;

    if offer_row.quantity > current_item.quantity then
      raise exception 'จำนวน % เปลี่ยนไปและไม่เพียงพอ', current_item.name;
    end if;
  end loop;

  select capacity into initiator_capacity
  from public.character_inventories
  where character_id = trade_row.initiator_character_id;

  select count(*) into initiator_count
  from public.inventory_items
  where character_id = trade_row.initiator_character_id;

  select capacity into recipient_capacity
  from public.character_inventories
  where character_id = trade_row.recipient_character_id;

  select count(*) into recipient_count
  from public.inventory_items
  where character_id = trade_row.recipient_character_id;

  select count(*) into initiator_out_full
  from public.character_trade_items ti
  join public.inventory_items i on i.id = ti.inventory_item_id
  where ti.trade_id = target_trade
    and ti.character_id = trade_row.initiator_character_id
    and ti.quantity = i.quantity;

  select count(*) into recipient_out_full
  from public.character_trade_items ti
  join public.inventory_items i on i.id = ti.inventory_item_id
  where ti.trade_id = target_trade
    and ti.character_id = trade_row.recipient_character_id
    and ti.quantity = i.quantity;

  select count(*) into initiator_incoming
  from public.character_trade_items
  where trade_id = target_trade
    and character_id = trade_row.recipient_character_id;

  select count(*) into recipient_incoming
  from public.character_trade_items
  where trade_id = target_trade
    and character_id = trade_row.initiator_character_id;

  if initiator_count - initiator_out_full + initiator_incoming > initiator_capacity then
    raise exception 'ช่องเก็บของของฝ่ายเริ่มเทรดไม่เพียงพอ';
  end if;

  if recipient_count - recipient_out_full + recipient_incoming > recipient_capacity then
    raise exception 'ช่องเก็บของของฝ่ายรับไม่เพียงพอ';
  end if;

  if (
    select temma_balance
    from public.character_inventories
    where character_id = trade_row.initiator_character_id
  ) < trade_row.initiator_temma then
    raise exception 'เงินของฝ่ายเริ่มเทรดไม่เพียงพอ';
  end if;

  if (
    select temma_balance
    from public.character_inventories
    where character_id = trade_row.recipient_character_id
  ) < trade_row.recipient_temma then
    raise exception 'เงินของฝ่ายรับไม่เพียงพอ';
  end if;

  update public.character_inventories
  set temma_balance = temma_balance
        - trade_row.initiator_temma
        + trade_row.recipient_temma,
      updated_at = now()
  where character_id = trade_row.initiator_character_id;

  update public.character_inventories
  set temma_balance = temma_balance
        - trade_row.recipient_temma
        + trade_row.initiator_temma,
      updated_at = now()
  where character_id = trade_row.recipient_character_id;

  -- Remove or reduce all outgoing items first so their slots become available.
  for offer_row in
    select ti.*, i.quantity as current_quantity
    from public.character_trade_items ti
    join public.inventory_items i on i.id = ti.inventory_item_id
    where ti.trade_id = target_trade
    order by ti.id
  loop
    if offer_row.quantity = offer_row.current_quantity then
      delete from public.inventory_items
      where id = offer_row.inventory_item_id;
    else
      update public.inventory_items
      set quantity = quantity - offer_row.quantity,
          updated_at = now()
      where id = offer_row.inventory_item_id;
    end if;
  end loop;

  -- Recreate each incoming stack in the other character's first free slot.
  for offer_row in
    select *
    from public.character_trade_items
    where trade_id = target_trade
    order by id
  loop
    destination_character := case
      when offer_row.character_id = trade_row.initiator_character_id
        then trade_row.recipient_character_id
      else trade_row.initiator_character_id
    end;

    destination_capacity := case
      when destination_character = trade_row.initiator_character_id
        then initiator_capacity
      else recipient_capacity
    end;

    select slot_value into destination_slot
    from generate_series(0, destination_capacity - 1) as gs(slot_value)
    where not exists (
      select 1
      from public.inventory_items i
      where i.character_id = destination_character
        and i.slot_index = slot_value
    )
    order by slot_value
    limit 1;

    if destination_slot is null then
      raise exception 'ไม่พบช่องว่างสำหรับไอเทมที่ได้รับ';
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
      gen_random_uuid(),
      destination_character,
      offer_row.item_name,
      offer_row.item_type,
      offer_row.category,
      offer_row.quantity,
      offer_row.description,
      offer_row.image_path,
      destination_slot,
      offer_row.allowed_equipment_slot,
      null,
      false
    );
  end loop;

  update public.character_trades
  set status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = target_trade;

  select name into initiator_name
  from public.characters
  where id = trade_row.initiator_character_id;

  select name into recipient_name
  from public.characters
  where id = trade_row.recipient_character_id;

  insert into public.character_exchange_notifications (
    campaign_id,
    recipient_character_id,
    sender_character_id,
    trade_id,
    kind,
    tone,
    title,
    body,
    payload
  )
  values
  (
    trade_row.campaign_id,
    trade_row.initiator_character_id,
    trade_row.recipient_character_id,
    target_trade,
    'trade_completed',
    'rainbow',
    'แลกเปลี่ยนสำเร็จ',
    initiator_name || ' และ ' || recipient_name || ' แลกเปลี่ยนของกันสำเร็จ',
    jsonb_build_object('partner_name', recipient_name)
  ),
  (
    trade_row.campaign_id,
    trade_row.recipient_character_id,
    trade_row.initiator_character_id,
    target_trade,
    'trade_completed',
    'rainbow',
    'แลกเปลี่ยนสำเร็จ',
    recipient_name || ' และ ' || initiator_name || ' แลกเปลี่ยนของกันสำเร็จ',
    jsonb_build_object('partner_name', initiator_name)
  );
end;
$$;

revoke all on function private.finalize_character_trade(uuid) from public;

create or replace function public.set_character_trade_ready(
  target_trade uuid,
  acting_character uuid,
  ready_state boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade_row public.character_trades%rowtype;
begin
  select * into trade_row
  from public.character_trades
  where id = target_trade
  for update;

  if trade_row.id is null or trade_row.status <> 'active' then
    raise exception 'หน้าต่างเทรดนี้ไม่ได้เปิดใช้งาน';
  end if;

  if acting_character not in (
    trade_row.initiator_character_id,
    trade_row.recipient_character_id
  ) or not private.can_control_exchange_character(acting_character) then
    raise exception 'คุณไม่มีสิทธิ์ยืนยันแทนตัวละครนี้';
  end if;

  update public.character_trades
  set initiator_ready = case
        when acting_character = initiator_character_id
          then ready_state
        else initiator_ready
      end,
      recipient_ready = case
        when acting_character = recipient_character_id
          then ready_state
        else recipient_ready
      end,
      updated_at = now()
  where id = target_trade
  returning * into trade_row;

  if trade_row.initiator_ready and trade_row.recipient_ready then
    perform private.finalize_character_trade(target_trade);
    return 'completed';
  end if;

  return case when ready_state then 'waiting' else 'active' end;
end;
$$;

create or replace function public.force_transfer_character_item(
  source_character uuid,
  target_character uuid,
  target_item uuid,
  transfer_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.characters%rowtype;
  target_row public.characters%rowtype;
  item_row public.inventory_items%rowtype;
  target_capacity integer;
  target_slot integer;
  notification_id uuid;
begin
  if transfer_quantity < 1 then
    raise exception 'จำนวนไอเทมต้องอย่างน้อย 1';
  end if;

  if source_character = target_character then
    raise exception 'ไม่สามารถยัดของให้ตัวละครเดียวกันได้';
  end if;

  select * into source_row from public.characters where id = source_character;
  select * into target_row from public.characters where id = target_character;

  if source_row.id is null or target_row.id is null
     or source_row.campaign_id is null
     or source_row.campaign_id is distinct from target_row.campaign_id then
    raise exception 'ตัวละครต้องอยู่ในแคมเปญเดียวกัน';
  end if;

  if not private.can_control_exchange_character(source_character) then
    raise exception 'คุณไม่มีสิทธิ์ส่งของจากตัวละครนี้';
  end if;

  select * into item_row
  from public.inventory_items
  where id = target_item
    and character_id = source_character
  for update;

  if item_row.id is null then
    raise exception 'ไม่พบไอเทมในคลังต้นทาง';
  end if;

  if item_row.equipped or item_row.equipment_slot is not null then
    raise exception 'ต้องถอดไอเทมออกจากช่องสวมใส่ก่อน';
  end if;

  if transfer_quantity > item_row.quantity then
    raise exception 'จำนวนไอเทมในคลังไม่เพียงพอ';
  end if;

  insert into public.character_inventories (character_id)
  values (target_character)
  on conflict (character_id) do nothing;

  select capacity into target_capacity
  from public.character_inventories
  where character_id = target_character
  for update;

  select slot_value into target_slot
  from generate_series(0, target_capacity - 1) as gs(slot_value)
  where not exists (
    select 1
    from public.inventory_items i
    where i.character_id = target_character
      and i.slot_index = slot_value
  )
  order by slot_value
  limit 1;

  if target_slot is null then
    raise exception 'ช่องเก็บของของผู้รับเต็มแล้ว';
  end if;

  if transfer_quantity = item_row.quantity then
    update public.inventory_items
    set character_id = target_character,
        slot_index = target_slot,
        equipment_slot = null,
        equipped = false,
        updated_at = now()
    where id = item_row.id;
  else
    update public.inventory_items
    set quantity = quantity - transfer_quantity,
        updated_at = now()
    where id = item_row.id;

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
      gen_random_uuid(),
      target_character,
      item_row.name,
      item_row.item_type,
      item_row.category,
      transfer_quantity,
      item_row.description,
      item_row.image_path,
      target_slot,
      item_row.allowed_equipment_slot,
      null,
      false
    );
  end if;

  insert into public.character_exchange_notifications (
    campaign_id,
    recipient_character_id,
    sender_character_id,
    kind,
    tone,
    title,
    body,
    payload
  )
  values (
    source_row.campaign_id,
    target_character,
    source_character,
    'forced_item',
    'red',
    'ถูกยัดของเข้าคลัง!',
    source_row.name || ' ยัด “' || item_row.name || '” จำนวน ' || transfer_quantity || ' ให้ ' || target_row.name,
    jsonb_build_object(
      'sender_name', source_row.name,
      'recipient_name', target_row.name,
      'item_name', item_row.name,
      'quantity', transfer_quantity,
      'image_path', item_row.image_path
    )
  )
  returning id into notification_id;

  return notification_id;
end;
$$;

create or replace function public.transfer_character_temma(
  source_character uuid,
  target_character uuid,
  transfer_amount bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.characters%rowtype;
  target_row public.characters%rowtype;
  source_balance bigint;
  notification_id uuid;
begin
  if transfer_amount < 1 then
    raise exception 'จำนวนเงินต้องอย่างน้อย 1 เทมมา';
  end if;

  if source_character = target_character then
    raise exception 'ไม่สามารถโอนเงินให้ตัวละครเดียวกันได้';
  end if;

  select * into source_row from public.characters where id = source_character;
  select * into target_row from public.characters where id = target_character;

  if source_row.id is null or target_row.id is null
     or source_row.campaign_id is null
     or source_row.campaign_id is distinct from target_row.campaign_id then
    raise exception 'ตัวละครต้องอยู่ในแคมเปญเดียวกัน';
  end if;

  if not private.can_control_exchange_character(source_character) then
    raise exception 'คุณไม่มีสิทธิ์โอนเงินจากตัวละครนี้';
  end if;

  insert into public.character_inventories (character_id)
  values (source_character)
  on conflict (character_id) do nothing;

  insert into public.character_inventories (character_id)
  values (target_character)
  on conflict (character_id) do nothing;

  perform 1
  from public.character_inventories
  where character_id in (source_character, target_character)
  order by character_id
  for update;

  select temma_balance into source_balance
  from public.character_inventories
  where character_id = source_character;

  if source_balance < transfer_amount then
    raise exception 'เงินเทมมาไม่เพียงพอ';
  end if;

  update public.character_inventories
  set temma_balance = temma_balance - transfer_amount,
      updated_at = now()
  where character_id = source_character;

  update public.character_inventories
  set temma_balance = temma_balance + transfer_amount,
      updated_at = now()
  where character_id = target_character;

  insert into public.character_exchange_notifications (
    campaign_id,
    recipient_character_id,
    sender_character_id,
    kind,
    tone,
    title,
    body,
    payload
  )
  values (
    source_row.campaign_id,
    target_character,
    source_character,
    'money_transfer',
    'gold',
    'ได้รับเงินเทมมา',
    source_row.name || ' โอนเงิน ' || transfer_amount || ' เทมมาให้ ' || target_row.name,
    jsonb_build_object(
      'sender_name', source_row.name,
      'recipient_name', target_row.name,
      'amount', transfer_amount
    )
  )
  returning id into notification_id;

  return notification_id;
end;
$$;

revoke all on function public.create_character_trade(uuid, uuid) from public;
revoke all on function public.respond_character_trade(uuid, uuid, boolean) from public;
revoke all on function public.cancel_character_trade(uuid, uuid) from public;
revoke all on function public.set_character_trade_offer(uuid, uuid, jsonb, bigint) from public;
revoke all on function public.set_character_trade_ready(uuid, uuid, boolean) from public;
revoke all on function public.force_transfer_character_item(uuid, uuid, uuid, integer) from public;
revoke all on function public.transfer_character_temma(uuid, uuid, bigint) from public;

grant execute on function public.create_character_trade(uuid, uuid) to authenticated;
grant execute on function public.respond_character_trade(uuid, uuid, boolean) to authenticated;
grant execute on function public.cancel_character_trade(uuid, uuid) to authenticated;
grant execute on function public.set_character_trade_offer(uuid, uuid, jsonb, bigint) to authenticated;
grant execute on function public.set_character_trade_ready(uuid, uuid, boolean) to authenticated;
grant execute on function public.force_transfer_character_item(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.transfer_character_temma(uuid, uuid, bigint) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'character_trades'
    ) then
      alter publication supabase_realtime add table public.character_trades;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'character_trade_items'
    ) then
      alter publication supabase_realtime add table public.character_trade_items;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'character_exchange_notifications'
    ) then
      alter publication supabase_realtime add table public.character_exchange_notifications;
    end if;
  end if;
end
$$;
