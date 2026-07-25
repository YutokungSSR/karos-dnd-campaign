-- Party vitals: HP, MP, food, and water are visible to campaign members,
-- but only the campaign Owner or a promoted DM may change them.

alter table public.characters
  add column if not exists current_food integer not null default 100,
  add column if not exists max_food integer not null default 100,
  add column if not exists current_water integer not null default 100,
  add column if not exists max_water integer not null default 100;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'characters_food_nonnegative_check'
      and conrelid = 'public.characters'::regclass
  ) then
    alter table public.characters
      add constraint characters_food_nonnegative_check
      check (current_food >= 0 and max_food >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'characters_water_nonnegative_check'
      and conrelid = 'public.characters'::regclass
  ) then
    alter table public.characters
      add constraint characters_water_nonnegative_check
      check (current_water >= 0 and max_water >= 1);
  end if;
end;
$$;

create or replace function private.can_manage_campaign_vitals(
  target_campaign uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.campaigns campaign
      where campaign.id = target_campaign
        and (
          campaign.dm_user_id = (select auth.uid())
          or exists (
            select 1
            from public.campaign_members member
            where member.campaign_id = campaign.id
              and member.user_id = (select auth.uid())
              and member.role in ('owner', 'dm')
          )
        )
    );
$$;

create or replace function public.can_manage_party_vitals(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_campaign_vitals(target_campaign);
$$;

create or replace function private.can_manage_character_vitals(
  target_character uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.characters character
    where character.id = target_character
      and character.campaign_id is not null
      and private.can_manage_campaign_vitals(character.campaign_id)
  );
$$;

create or replace function private.enforce_character_vitals_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_writer boolean;
begin
  trusted_writer :=
    session_user in ('postgres', 'supabase_admin')
    or coalesce((select auth.role()), '') = 'service_role';

  if tg_op = 'INSERT' then
    if
      not trusted_writer
      and row(
        new.current_hp,
        new.max_hp,
        new.current_mp,
        new.max_mp,
        new.current_food,
        new.max_food,
        new.current_water,
        new.max_water
      )
      is distinct from row(20, 20, 10, 10, 100, 100, 100, 100)
      and not private.can_manage_campaign_vitals(new.campaign_id)
    then
      raise exception using
        errcode = '42501',
        message = 'ตัวละครใหม่ต้องใช้ค่าพลังเริ่มต้นจนกว่า DM หรือ Owner จะแก้ไข';
    end if;

    return new;
  end if;

  if
    row(
      new.current_hp,
      new.max_hp,
      new.current_mp,
      new.max_mp,
      new.current_food,
      new.max_food,
      new.current_water,
      new.max_water
    )
    is distinct from
    row(
      old.current_hp,
      old.max_hp,
      old.current_mp,
      old.max_mp,
      old.current_food,
      old.max_food,
      old.current_water,
      old.max_water
    )
    and not trusted_writer
    and not private.can_manage_character_vitals(old.id)
  then
    raise exception using
      errcode = '42501',
      message = 'เฉพาะ DM และ Owner เท่านั้นที่แก้ไขค่าพลังได้';
  end if;

  return new;
end;
$$;

drop trigger if exists characters_vitals_insert_defaults on public.characters;
create trigger characters_vitals_insert_defaults
before insert
on public.characters
for each row
execute function private.enforce_character_vitals_update();

drop trigger if exists characters_vitals_dm_only on public.characters;
create trigger characters_vitals_dm_only
before update of
  current_hp,
  max_hp,
  current_mp,
  max_mp,
  current_food,
  max_food,
  current_water,
  max_water
on public.characters
for each row
execute function private.enforce_character_vitals_update();

create or replace function private.adjust_character_vital_checked(
  target_character uuid,
  vital_name text,
  delta_amount integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_value integer;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'กรุณาเข้าสู่ระบบ';
  end if;

  if vital_name is null or vital_name not in ('hp', 'mp', 'food', 'water') then
    raise exception using
      errcode = '22023',
      message = 'ไม่รู้จักค่าพลังที่ต้องการแก้ไข';
  end if;

  if delta_amount is null or delta_amount not between -10000 and 10000 then
    raise exception using
      errcode = '22023',
      message = 'จำนวนที่ปรับไม่ถูกต้อง';
  end if;

  if not private.can_manage_character_vitals(target_character) then
    raise exception using
      errcode = '42501',
      message = 'เฉพาะ DM และ Owner เท่านั้นที่แก้ไขค่าพลังได้';
  end if;

  update public.characters
  set
    current_hp = case
      when vital_name = 'hp' then
        least(
          max_hp::bigint,
          greatest(0::bigint, current_hp::bigint + delta_amount::bigint)
        )::integer
      else current_hp
    end,
    current_mp = case
      when vital_name = 'mp' then
        least(
          max_mp::bigint,
          greatest(0::bigint, current_mp::bigint + delta_amount::bigint)
        )::integer
      else current_mp
    end,
    current_food = case
      when vital_name = 'food' then
        least(
          max_food::bigint,
          greatest(0::bigint, current_food::bigint + delta_amount::bigint)
        )::integer
      else current_food
    end,
    current_water = case
      when vital_name = 'water' then
        least(
          max_water::bigint,
          greatest(0::bigint, current_water::bigint + delta_amount::bigint)
        )::integer
      else current_water
    end
  where id = target_character
  returning case vital_name
    when 'hp' then current_hp
    when 'mp' then current_mp
    when 'food' then current_food
    when 'water' then current_water
  end
  into next_value;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ไม่พบตัวละคร';
  end if;

  return next_value;
end;
$$;

create or replace function public.adjust_character_vital(
  target_character uuid,
  vital_name text,
  delta_amount integer
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.adjust_character_vital_checked(
    target_character,
    vital_name,
    delta_amount
  );
$$;

revoke all on function private.can_manage_campaign_vitals(uuid)
  from public, anon, authenticated;
revoke all on function private.can_manage_character_vitals(uuid)
  from public, anon, authenticated;
revoke all on function private.enforce_character_vitals_update()
  from public, anon, authenticated;
revoke all on function private.adjust_character_vital_checked(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.can_manage_party_vitals(uuid)
  from public, anon;
revoke all on function public.adjust_character_vital(uuid, text, integer)
  from public, anon;

grant execute on function private.adjust_character_vital_checked(
  uuid,
  text,
  integer
) to authenticated;
grant execute on function public.can_manage_party_vitals(uuid) to authenticated;
grant execute on function public.adjust_character_vital(
  uuid,
  text,
  integer
) to authenticated;

comment on function public.adjust_character_vital(uuid, text, integer) is
  'Atomically adjusts one character vital. Only the campaign Owner or DM may execute it.';
