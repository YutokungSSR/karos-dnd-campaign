-- Let character owners remove their own inventory items and add a DM-managed
-- Temma balance. Currency changes go through one atomic RPC so concurrent
-- adjustments cannot overwrite each other or produce a negative balance.

begin;

alter table public.character_inventories
  add column if not exists temma_balance bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'character_inventories_temma_balance_check'
      and conrelid = 'public.character_inventories'::regclass
  ) then
    alter table public.character_inventories
      add constraint character_inventories_temma_balance_check
      check (temma_balance between 0 and 9007199254740991);
  end if;
end;
$$;

create or replace function private.adjust_character_temma_checked(
  target_character_id uuid,
  amount_delta bigint
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_balance bigint;
  next_balance numeric;
  updated_balance bigint;
begin
  if caller_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if amount_delta is null or amount_delta = 0 then
    raise exception 'Temma adjustment must not be zero'
      using errcode = '22023';
  end if;

  select inventory.temma_balance
  into current_balance
  from public.character_inventories inventory
  join public.characters character
    on character.id = inventory.character_id
  join public.campaigns campaign
    on campaign.id = character.campaign_id
  where inventory.character_id = target_character_id
    and campaign.dm_user_id = caller_id
  for update of inventory;

  if not found then
    raise exception 'Only the campaign DM can adjust Temma'
      using errcode = '42501';
  end if;

  next_balance := current_balance::numeric + amount_delta::numeric;

  if next_balance < 0 then
    raise exception 'Temma balance cannot be negative'
      using errcode = '23514';
  end if;

  if next_balance > 9007199254740991 then
    raise exception 'Temma balance exceeds the supported maximum'
      using errcode = '23514';
  end if;

  update public.character_inventories
  set temma_balance = next_balance::bigint
  where character_id = target_character_id
  returning temma_balance into updated_balance;

  return updated_balance;
end;
$$;

revoke all on function private.adjust_character_temma_checked(uuid, bigint)
from public, anon, authenticated;
grant execute on function private.adjust_character_temma_checked(uuid, bigint)
to authenticated;

create or replace function public.adjust_character_temma(
  target_character_id uuid,
  amount_delta bigint
)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.adjust_character_temma_checked(
    target_character_id,
    amount_delta
  );
$$;

revoke all on function public.adjust_character_temma(uuid, bigint)
from public, anon;
grant execute on function public.adjust_character_temma(uuid, bigint)
to authenticated;

-- Keep direct inventory-setting edits limited to capacity. Temma must only be
-- changed through the checked RPC above.
revoke update on table public.character_inventories from authenticated;
grant update (capacity) on table public.character_inventories to authenticated;

drop policy if exists "dm deletes inventory items"
on public.inventory_items;
drop policy if exists "owner and dm delete inventory items"
on public.inventory_items;

create policy "owner and dm delete inventory items"
on public.inventory_items for delete
to authenticated
using ((select private.can_view_character_inventory(character_id)));

drop policy if exists "inventory images deleted by owner and dm"
on storage.objects;

create policy "inventory images deleted by owner and dm"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'inventory-item-images'
  and (
    select private.can_view_character_inventory(
      private.inventory_character_id_from_path(name)
    )
  )
);

commit;
