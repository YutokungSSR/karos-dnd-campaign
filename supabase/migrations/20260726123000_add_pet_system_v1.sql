-- Karos D&D Campaign — Pet System V1 Core
-- Core scope: pet requests, DM approval, one active pet, profile/stats/skills,
-- relationship taps with server-side limits, and evolution-ready data scaffolding.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.character_pet_settings (
  character_id uuid primary key references public.characters(id) on delete cascade,
  max_pets integer not null default 0 check (max_pets between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  approved_by uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  title text not null default '',
  pet_type text not null default 'สัตว์บก' check (char_length(pet_type) between 1 and 80),
  species text not null default '' check (char_length(species) <= 120),
  description text not null default '' check (char_length(description) <= 4000),
  level integer not null default 1 check (level between 1 and 9999),
  rank text not null default 'F' check (char_length(rank) between 1 and 40),
  element text not null default '' check (char_length(element) <= 80),
  status text not null default 'pending'
    check (status in ('pending','revision','approved','rejected','suspended')),
  approval_note text not null default '' check (char_length(approval_note) <= 2000),
  is_active boolean not null default false,
  current_form_id uuid,
  current_hp integer not null default 20 check (current_hp >= 0),
  max_hp integer not null default 20 check (max_hp >= 1),
  current_mp integer not null default 10 check (current_mp >= 0),
  max_mp integer not null default 10 check (max_mp >= 0),
  stats jsonb not null default '{"STR":5,"VIT":5,"AGI":5,"INT":5,"DEX":5,"WIS":5,"CHA":5}'::jsonb,
  relationship_points bigint not null default 0 check (relationship_points >= 0),
  relationship_max bigint not null default 1000 check (relationship_max between 1 and 9007199254740991),
  tap_enabled boolean not null default true,
  tap_limit integer not null default 10 check (tap_limit between 0 and 10000),
  tap_window_seconds integer not null default 300 check (tap_window_seconds between 10 and 604800),
  tap_min_points integer not null default 1 check (tap_min_points between 0 and 1000000),
  tap_max_points integer not null default 5 check (tap_max_points between 0 and 1000000),
  tap_daily_cap integer not null default 0 check (tap_daily_cap between 0 and 1000000000),
  inventory_capacity integer not null default 5 check (inventory_capacity between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  check (current_hp <= max_hp),
  check (current_mp <= max_mp),
  check (relationship_points <= relationship_max),
  check (tap_min_points <= tap_max_points)
);

create unique index if not exists pets_one_active_per_character_idx
  on public.pets(character_id)
  where is_active and status = 'approved';
create index if not exists pets_character_created_idx
  on public.pets(character_id, created_at, id);
create index if not exists pets_campaign_idx on public.pets(campaign_id);

create table if not exists public.pet_forms (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  parent_form_id uuid references public.pet_forms(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  image_path text not null check (char_length(image_path) between 1 and 900),
  relationship_required bigint not null default 0 check (relationship_required >= 0),
  element text not null default '' check (char_length(element) <= 80),
  pet_type text not null default '' check (char_length(pet_type) <= 80),
  stat_overrides jsonb not null default '{}'::jsonb,
  is_starting boolean not null default false,
  is_hidden boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pets
  drop constraint if exists pets_current_form_id_fkey;
alter table public.pets
  add constraint pets_current_form_id_fkey
  foreign key (current_form_id) references public.pet_forms(id) on delete set null;

create unique index if not exists pet_forms_one_starting_idx
  on public.pet_forms(pet_id) where is_starting;
create index if not exists pet_forms_pet_sort_idx
  on public.pet_forms(pet_id, sort_order, created_at);

create table if not exists public.pet_unlocked_forms (
  pet_id uuid not null references public.pets(id) on delete cascade,
  form_id uuid not null references public.pet_forms(id) on delete cascade,
  unlocked_by uuid references public.profiles(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key (pet_id, form_id)
);

create table if not exists public.pet_skills (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  form_id uuid references public.pet_forms(id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  skill_type text not null default 'ทั่วไป' check (char_length(skill_type) <= 80),
  description text not null default '' check (char_length(description) <= 5000),
  cost text not null default '' check (char_length(cost) <= 300),
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pet_skills_pet_sort_idx
  on public.pet_skills(pet_id, sort_order, created_at);

create table if not exists public.pet_tap_windows (
  pet_id uuid not null references public.pets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  tap_count integer not null default 0 check (tap_count >= 0),
  points_earned bigint not null default 0 check (points_earned >= 0),
  updated_at timestamptz not null default now(),
  primary key (pet_id, user_id)
);

create table if not exists public.pet_relationship_actions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('tap','dm','event','evolution','system')),
  delta integer not null,
  points_after bigint not null check (points_after >= 0),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists pet_relationship_actions_pet_created_idx
  on public.pet_relationship_actions(pet_id, created_at desc);
create index if not exists pet_relationship_actions_actor_created_idx
  on public.pet_relationship_actions(actor_id, created_at desc);

-- Evolution-ready scaffolding. UI and cinematic playback are added in later phases.
create table if not exists public.pet_evolution_requests (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  from_form_id uuid references public.pet_forms(id) on delete set null,
  target_form_id uuid not null references public.pet_forms(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  note text not null default '' check (char_length(note) <= 2000),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pet_evolution_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  from_form_id uuid references public.pet_forms(id) on delete set null,
  to_form_id uuid not null references public.pet_forms(id) on delete cascade,
  triggered_by uuid references public.profiles(id) on delete set null,
  event_kind text not null default 'evolution'
    check (event_kind in ('evolution','reversion')),
  cinematic_theme text not null default 'arcane',
  duration_ms integer not null default 7000 check (duration_ms between 5000 and 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.pet_evolution_receipts (
  event_id uuid not null references public.pet_evolution_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'unseen'
    check (status in ('unseen','watching','viewed','skipped')),
  viewed_at timestamptz,
  primary key (event_id, user_id)
);

create or replace function private.pet_can_manage_campaign(target_campaign uuid)
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

create or replace function private.pet_owns_character(target_character uuid)
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
      from public.characters character
      where character.id = target_character
        and character.owner_id = (select auth.uid())
    );
$$;

create or replace function private.pet_can_view_character(target_character uuid)
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
      and (
        character.owner_id = (select auth.uid())
        or (
          character.campaign_id is not null
          and private.pet_can_manage_campaign(character.campaign_id)
        )
      )
  );
$$;

create or replace function private.pet_can_view(target_pet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets pet
    where pet.id = target_pet
      and private.pet_can_view_character(pet.character_id)
  );
$$;

create or replace function private.pet_can_manage(target_pet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets pet
    join public.characters character on character.id = pet.character_id
    where pet.id = target_pet
      and character.campaign_id is not null
      and private.pet_can_manage_campaign(character.campaign_id)
  );
$$;

create or replace function private.pet_storage_pet_id(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folders text[];
  parsed uuid;
begin
  folders := storage.foldername(object_name);
  if coalesce(array_length(folders, 1), 0) < 2 then
    return null;
  end if;

  begin
    parsed := folders[2]::uuid;
  exception when others then
    return null;
  end;

  return parsed;
end;
$$;

create or replace function private.pet_storage_can_create(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folders text[];
  target_pet uuid;
begin
  folders := storage.foldername(object_name);

  if coalesce(array_length(folders, 1), 0) <> 2 then
    return false;
  end if;

  if folders[1] <> (select auth.uid())::text then
    return false;
  end if;

  target_pet := private.pet_storage_pet_id(object_name);
  if target_pet is null then
    return false;
  end if;

  return not exists (
    select 1
    from public.pets pet
    where pet.id = target_pet
  );
end;
$$;

create or replace function private.pet_storage_can_cleanup(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.pet_storage_can_create(object_name);
$$;

create or replace function private.pet_assign_current_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select character.campaign_id
  into new.campaign_id
  from public.characters character
  where character.id = new.character_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'ไม่พบตัวละครเจ้าของสัตว์เลี้ยง';
  end if;

  return new;
end;
$$;

create or replace function private.pet_sync_character_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.campaign_id is distinct from old.campaign_id then
    update public.pets
    set campaign_id = new.campaign_id
    where character_id = new.id
      and campaign_id is distinct from new.campaign_id;
  end if;

  return new;
end;
$$;

create or replace function private.pet_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pets_assign_current_campaign on public.pets;
create trigger pets_assign_current_campaign
before insert or update of character_id, campaign_id
on public.pets
for each row execute function private.pet_assign_current_campaign();

drop trigger if exists characters_sync_pets_campaign on public.characters;
create trigger characters_sync_pets_campaign
after update of campaign_id
on public.characters
for each row execute function private.pet_sync_character_campaign();

drop trigger if exists character_pet_settings_updated_at on public.character_pet_settings;
create trigger character_pet_settings_updated_at
before update on public.character_pet_settings
for each row execute function private.pet_set_updated_at();

drop trigger if exists pets_updated_at on public.pets;
create trigger pets_updated_at
before update on public.pets
for each row execute function private.pet_set_updated_at();

drop trigger if exists pet_forms_updated_at on public.pet_forms;
create trigger pet_forms_updated_at
before update on public.pet_forms
for each row execute function private.pet_set_updated_at();

drop trigger if exists pet_skills_updated_at on public.pet_skills;
create trigger pet_skills_updated_at
before update on public.pet_skills
for each row execute function private.pet_set_updated_at();

drop trigger if exists pet_tap_windows_updated_at on public.pet_tap_windows;
create trigger pet_tap_windows_updated_at
before update on public.pet_tap_windows
for each row execute function private.pet_set_updated_at();

alter table public.character_pet_settings enable row level security;
alter table public.pets enable row level security;
alter table public.pet_forms enable row level security;
alter table public.pet_unlocked_forms enable row level security;
alter table public.pet_skills enable row level security;
alter table public.pet_tap_windows enable row level security;
alter table public.pet_relationship_actions enable row level security;
alter table public.pet_evolution_requests enable row level security;
alter table public.pet_evolution_events enable row level security;
alter table public.pet_evolution_receipts enable row level security;

drop policy if exists character_pet_settings_read on public.character_pet_settings;
create policy character_pet_settings_read
on public.character_pet_settings for select to authenticated
using (private.pet_can_view_character(character_id));

drop policy if exists pets_read on public.pets;
create policy pets_read
on public.pets for select to authenticated
using (private.pet_can_view(id));

drop policy if exists pet_forms_read on public.pet_forms;
create policy pet_forms_read
on public.pet_forms for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_unlocked_forms_read on public.pet_unlocked_forms;
create policy pet_unlocked_forms_read
on public.pet_unlocked_forms for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_skills_read on public.pet_skills;
create policy pet_skills_read
on public.pet_skills for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_skills_manage on public.pet_skills;
create policy pet_skills_manage
on public.pet_skills for all to authenticated
using (private.pet_can_manage(pet_id))
with check (private.pet_can_manage(pet_id));

drop policy if exists pet_tap_windows_read on public.pet_tap_windows;
create policy pet_tap_windows_read
on public.pet_tap_windows for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_relationship_actions_read on public.pet_relationship_actions;
create policy pet_relationship_actions_read
on public.pet_relationship_actions for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_evolution_requests_read on public.pet_evolution_requests;
create policy pet_evolution_requests_read
on public.pet_evolution_requests for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_evolution_events_read on public.pet_evolution_events;
create policy pet_evolution_events_read
on public.pet_evolution_events for select to authenticated
using (private.pet_can_view(pet_id));

drop policy if exists pet_evolution_receipts_read on public.pet_evolution_receipts;
create policy pet_evolution_receipts_read
on public.pet_evolution_receipts for select to authenticated
using (user_id = (select auth.uid()));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pet-images',
  'pet-images',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pet_images_insert on storage.objects;
create policy pet_images_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pet-images'
  and private.pet_storage_can_create(name)
);

drop policy if exists pet_images_read on storage.objects;
create policy pet_images_read
on storage.objects for select to authenticated
using (
  bucket_id = 'pet-images'
  and (
    private.pet_can_view(private.pet_storage_pet_id(name))
    or private.pet_storage_can_cleanup(name)
  )
);

drop policy if exists pet_images_update on storage.objects;
create policy pet_images_update
on storage.objects for update to authenticated
using (
  bucket_id = 'pet-images'
  and private.pet_can_manage(private.pet_storage_pet_id(name))
)
with check (
  bucket_id = 'pet-images'
  and private.pet_can_manage(private.pet_storage_pet_id(name))
);

drop policy if exists pet_images_delete on storage.objects;
create policy pet_images_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'pet-images'
  and (
    private.pet_can_manage(private.pet_storage_pet_id(name))
    or private.pet_storage_can_cleanup(name)
  )
);

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
    and pet.status <> 'rejected';

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
    id,
    character_id,
    campaign_id,
    created_by,
    name,
    title,
    pet_type,
    species,
    description,
    status
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
    id,
    pet_id,
    name,
    description,
    image_path,
    relationship_required,
    pet_type,
    is_starting,
    created_by
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

create or replace function public.update_pet_request(
  target_pet uuid,
  pet_name text,
  pet_title text,
  requested_pet_type text,
  requested_species text,
  pet_description text,
  starting_form_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  starting_form uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบ';
  end if;

  if trim(coalesce(pet_name, '')) = '' then
    raise exception using errcode = '22023', message = 'กรุณาตั้งชื่อสัตว์เลี้ยง';
  end if;

  select form.id
  into starting_form
  from public.pets pet
  join public.characters character on character.id = pet.character_id
  join public.pet_forms form on form.pet_id = pet.id and form.is_starting
  where pet.id = target_pet
    and character.owner_id = (select auth.uid())
    and pet.status in ('pending', 'revision')
  for update of pet;

  if not found then
    raise exception using errcode = '42501', message = 'แก้ไขได้เฉพาะคำขอของตนเองที่กำลังรอตรวจสอบ';
  end if;

  update public.pets
  set name = left(trim(pet_name), 120),
      title = left(trim(coalesce(pet_title, '')), 120),
      pet_type = left(coalesce(nullif(trim(requested_pet_type), ''), 'สัตว์บก'), 80),
      species = left(trim(coalesce(requested_species, '')), 120),
      description = left(trim(coalesce(pet_description, '')), 4000),
      status = 'pending',
      approval_note = ''
  where id = target_pet;

  update public.pet_forms
  set name = left(coalesce(nullif(trim(starting_form_name), ''), trim(pet_name) || ' · ร่างเริ่มต้น'), 120),
      description = left(trim(coalesce(pet_description, '')), 4000),
      pet_type = left(coalesce(nullif(trim(requested_pet_type), ''), 'สัตว์บก'), 80)
  where id = starting_form;

  return target_pet;
end;
$$;

create or replace function public.resolve_pet_request(
  target_pet uuid,
  next_status text,
  review_note text default ''
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  starting_form uuid;
  target_character uuid;
  current_status text;
  active_exists boolean;
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่ตรวจคำขอสัตว์เลี้ยงได้';
  end if;

  if next_status not in ('approved','revision','rejected','suspended') then
    raise exception using errcode = '22023', message = 'สถานะคำขอไม่ถูกต้อง';
  end if;

  select pet.character_id, pet.status
  into target_character, current_status
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  if next_status = 'suspended' and current_status <> 'approved' then
    raise exception using errcode = '22023', message = 'ระงับได้เฉพาะสัตว์เลี้ยงที่อนุมัติแล้ว';
  end if;

  if next_status in ('revision', 'rejected')
    and current_status not in ('pending', 'revision')
  then
    raise exception using errcode = '22023', message = 'สถานะปัจจุบันไม่สามารถส่งกลับให้แก้ไขหรือปฏิเสธได้';
  end if;

  if next_status = 'approved'
    and current_status not in ('pending', 'revision', 'suspended')
  then
    raise exception using errcode = '22023', message = 'สถานะปัจจุบันไม่สามารถอนุมัติได้';
  end if;

  select form.id
  into starting_form
  from public.pet_forms form
  where form.pet_id = target_pet and form.is_starting
  order by form.created_at
  limit 1;

  if next_status = 'approved' and starting_form is null then
    raise exception using errcode = '22023', message = 'สัตว์เลี้ยงยังไม่มีรูปและร่างเริ่มต้น';
  end if;

  if next_status = 'approved' then
    select exists (
      select 1 from public.pets pet
      where pet.character_id = target_character
        and pet.status = 'approved'
        and pet.is_active
        and pet.id <> target_pet
    ) into active_exists;

    update public.pets
    set status = 'approved',
        approval_note = left(trim(coalesce(review_note, '')), 2000),
        approved_by = (select auth.uid()),
        approved_at = now(),
        current_form_id = coalesce(current_form_id, starting_form),
        is_active = not active_exists
    where id = target_pet;

    insert into public.pet_unlocked_forms(pet_id, form_id, unlocked_by)
    values (target_pet, starting_form, (select auth.uid()))
    on conflict (pet_id, form_id) do nothing;
  else
    update public.pets
    set status = next_status,
        approval_note = left(trim(coalesce(review_note, '')), 2000),
        approved_by = (select auth.uid()),
        approved_at = case when next_status = 'rejected' then now() else approved_at end,
        is_active = false
    where id = target_pet;
  end if;

  return next_status;
end;
$$;

create or replace function public.set_active_pet(target_pet uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_character uuid;
begin
  select pet.character_id
  into target_character
  from public.pets pet
  where pet.id = target_pet
    and pet.status = 'approved'
    and (
      private.pet_owns_character(pet.character_id)
      or private.pet_can_manage(pet.id)
    )
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'ไม่สามารถเรียกใช้สัตว์เลี้ยงตัวนี้ได้';
  end if;

  update public.pets
  set is_active = false
  where character_id = target_character and is_active;

  update public.pets
  set is_active = true
  where id = target_pet;

  return target_pet;
end;
$$;

create or replace function public.set_character_pet_limit(
  target_character uuid,
  maximum_pets integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_campaign uuid;
begin
  select character.campaign_id
  into target_campaign
  from public.characters character
  where character.id = target_character;

  if target_campaign is null or not private.pet_can_manage_campaign(target_campaign) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่กำหนดจำนวนสัตว์เลี้ยงได้';
  end if;

  if maximum_pets is null or maximum_pets not between 0 and 100 then
    raise exception using errcode = '22023', message = 'จำนวนสัตว์เลี้ยงต้องอยู่ระหว่าง 0 ถึง 100';
  end if;

  insert into public.character_pet_settings(character_id, max_pets)
  values (target_character, maximum_pets)
  on conflict (character_id) do update set max_pets = excluded.max_pets;

  return maximum_pets;
end;
$$;

create or replace function public.update_pet_profile_dm(
  target_pet uuid,
  profile_patch jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_max_hp integer;
  next_max_mp integer;
  next_relationship_max bigint;
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่แก้ข้อมูลสัตว์เลี้ยงได้';
  end if;

  select
    case when profile_patch ? 'max_hp' then greatest(1, (profile_patch->>'max_hp')::integer) else pet.max_hp end,
    case when profile_patch ? 'max_mp' then greatest(0, (profile_patch->>'max_mp')::integer) else pet.max_mp end,
    case when profile_patch ? 'relationship_max' then greatest(1::bigint, (profile_patch->>'relationship_max')::bigint) else pet.relationship_max end
  into next_max_hp, next_max_mp, next_relationship_max
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  update public.pets pet
  set
    name = case when profile_patch ? 'name' then left(coalesce(nullif(trim(profile_patch->>'name'), ''), pet.name), 120) else pet.name end,
    title = case when profile_patch ? 'title' then left(trim(coalesce(profile_patch->>'title', '')), 120) else pet.title end,
    pet_type = case when profile_patch ? 'pet_type' then left(coalesce(nullif(trim(profile_patch->>'pet_type'), ''), pet.pet_type), 80) else pet.pet_type end,
    species = case when profile_patch ? 'species' then left(trim(coalesce(profile_patch->>'species', '')), 120) else pet.species end,
    description = case when profile_patch ? 'description' then left(trim(coalesce(profile_patch->>'description', '')), 4000) else pet.description end,
    level = case when profile_patch ? 'level' then greatest(1, least(9999, (profile_patch->>'level')::integer)) else pet.level end,
    rank = case when profile_patch ? 'rank' then left(coalesce(nullif(trim(profile_patch->>'rank'), ''), pet.rank), 40) else pet.rank end,
    element = case when profile_patch ? 'element' then left(trim(coalesce(profile_patch->>'element', '')), 80) else pet.element end,
    max_hp = next_max_hp,
    current_hp = case when profile_patch ? 'current_hp' then least(next_max_hp, greatest(0, (profile_patch->>'current_hp')::integer)) else least(next_max_hp, pet.current_hp) end,
    max_mp = next_max_mp,
    current_mp = case when profile_patch ? 'current_mp' then least(next_max_mp, greatest(0, (profile_patch->>'current_mp')::integer)) else least(next_max_mp, pet.current_mp) end,
    stats = case when profile_patch ? 'stats' and jsonb_typeof(profile_patch->'stats') = 'object' then profile_patch->'stats' else pet.stats end,
    relationship_max = next_relationship_max,
    relationship_points = least(next_relationship_max, pet.relationship_points),
    inventory_capacity = case when profile_patch ? 'inventory_capacity' then greatest(0, least(500, (profile_patch->>'inventory_capacity')::integer)) else pet.inventory_capacity end
  where pet.id = target_pet;

  return target_pet;
end;
$$;

create or replace function public.configure_pet_relationship(
  target_pet uuid,
  enabled boolean,
  maximum_taps integer,
  window_seconds integer,
  minimum_points integer,
  maximum_points integer,
  daily_cap integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่ตั้งค่ากิจกรรมความสัมพันธ์ได้';
  end if;

  if maximum_taps not between 0 and 10000
    or window_seconds not between 10 and 604800
    or minimum_points not between 0 and 1000000
    or maximum_points not between 0 and 1000000
    or minimum_points > maximum_points
    or daily_cap not between 0 and 1000000000
  then
    raise exception using errcode = '22023', message = 'ค่ากิจกรรมความสัมพันธ์ไม่ถูกต้อง';
  end if;

  update public.pets
  set tap_enabled = coalesce(enabled, false),
      tap_limit = maximum_taps,
      tap_window_seconds = window_seconds,
      tap_min_points = minimum_points,
      tap_max_points = maximum_points,
      tap_daily_cap = daily_cap
  where id = target_pet;

  return target_pet;
end;
$$;

create or replace function public.adjust_pet_relationship(
  target_pet uuid,
  delta_amount integer,
  reason text default ''
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old_points bigint;
  next_points bigint;
  actual_delta integer;
begin
  if not private.pet_can_manage(target_pet) then
    raise exception using errcode = '42501', message = 'เฉพาะ DM และ Owner เท่านั้นที่ปรับค่าความสัมพันธ์ได้';
  end if;

  if delta_amount is null or delta_amount not between -1000000000 and 1000000000 then
    raise exception using errcode = '22023', message = 'จำนวนแต้มไม่ถูกต้อง';
  end if;

  select pet.relationship_points
  into old_points
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  update public.pets pet
  set relationship_points = least(
    pet.relationship_max,
    greatest(0::bigint, pet.relationship_points + delta_amount::bigint)
  )
  where pet.id = target_pet
  returning pet.relationship_points into next_points;

  actual_delta := (next_points - old_points)::integer;

  insert into public.pet_relationship_actions(
    pet_id, actor_id, source, delta, points_after, note
  ) values (
    target_pet,
    (select auth.uid()),
    'dm',
    actual_delta,
    next_points,
    left(trim(coalesce(reason, '')), 1000)
  );

  return next_points;
end;
$$;

create or replace function public.get_pet_tap_status(target_pet uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pet_record public.pets%rowtype;
  window_record public.pet_tap_windows%rowtype;
  reset_at timestamptz;
  used_count integer := 0;
begin
  if not private.pet_can_view(target_pet) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์ดูข้อมูลสัตว์เลี้ยง';
  end if;

  select * into pet_record from public.pets where id = target_pet;
  select * into window_record
  from public.pet_tap_windows
  where pet_id = target_pet and user_id = (select auth.uid());

  if found and now() < window_record.window_started_at + make_interval(secs => pet_record.tap_window_seconds) then
    used_count := window_record.tap_count;
    reset_at := window_record.window_started_at + make_interval(secs => pet_record.tap_window_seconds);
  else
    reset_at := now();
  end if;

  return jsonb_build_object(
    'enabled', pet_record.tap_enabled,
    'used', used_count,
    'limit', pet_record.tap_limit,
    'reset_at', reset_at,
    'relationship_points', pet_record.relationship_points,
    'relationship_max', pet_record.relationship_max
  );
end;
$$;

create or replace function public.tap_pet_relationship(target_pet uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pet_record public.pets%rowtype;
  window_record public.pet_tap_windows%rowtype;
  owner_id uuid;
  reset_at timestamptz;
  points_today bigint := 0;
  remaining_daily bigint;
  rolled_points integer;
  applied_points integer;
  next_points bigint;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบ';
  end if;

  select *
  into pet_record
  from public.pets pet
  where pet.id = target_pet
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัตว์เลี้ยง';
  end if;

  select character.owner_id
  into owner_id
  from public.characters character
  where character.id = pet_record.character_id;

  if owner_id <> (select auth.uid()) then
    raise exception using errcode = '42501', message = 'เฉพาะเจ้าของสัตว์เลี้ยงเท่านั้นที่ทำกิจกรรมนี้ได้';
  end if;

  if pet_record.status <> 'approved' then
    raise exception using errcode = '22023', message = 'สัตว์เลี้ยงต้องได้รับอนุมัติก่อน';
  end if;

  if not pet_record.tap_enabled or pet_record.tap_limit <= 0 then
    raise exception using errcode = '22023', message = 'DM ปิดกิจกรรมเพิ่มความสัมพันธ์ไว้';
  end if;

  if pet_record.relationship_points >= pet_record.relationship_max then
    raise exception using errcode = '22023', message = 'ค่าความสัมพันธ์เต็มแล้ว';
  end if;

  select * into window_record
  from public.pet_tap_windows
  where pet_id = target_pet and user_id = (select auth.uid())
  for update;

  if not found then
    insert into public.pet_tap_windows(
      pet_id, user_id, window_started_at, tap_count, points_earned
    ) values (
      target_pet, (select auth.uid()), now(), 0, 0
    ) returning * into window_record;
  elsif now() >= window_record.window_started_at + make_interval(secs => pet_record.tap_window_seconds) then
    update public.pet_tap_windows
    set window_started_at = now(), tap_count = 0, points_earned = 0
    where pet_id = target_pet and user_id = (select auth.uid())
    returning * into window_record;
  end if;

  reset_at := window_record.window_started_at + make_interval(secs => pet_record.tap_window_seconds);

  if window_record.tap_count >= pet_record.tap_limit then
    raise exception using
      errcode = '22023',
      message = 'สัตว์เลี้ยงต้องการพักผ่อน กรุณารอรอบถัดไป';
  end if;

  if pet_record.tap_daily_cap > 0 then
    select coalesce(sum(action.delta), 0)::bigint
    into points_today
    from public.pet_relationship_actions action
    where action.pet_id = target_pet
      and action.actor_id = (select auth.uid())
      and action.source = 'tap'
      and action.created_at >= date_trunc('day', now());

    remaining_daily := pet_record.tap_daily_cap - points_today;
    if remaining_daily <= 0 then
      raise exception using errcode = '22023', message = 'ได้รับแต้มความสัมพันธ์ครบขีดจำกัดประจำวันแล้ว';
    end if;
  else
    remaining_daily := 9223372036854775807;
  end if;

  rolled_points := floor(
    random() * (pet_record.tap_max_points - pet_record.tap_min_points + 1)
  )::integer + pet_record.tap_min_points;

  applied_points := least(
    rolled_points::bigint,
    remaining_daily,
    pet_record.relationship_max - pet_record.relationship_points
  )::integer;

  if applied_points <= 0 then
    raise exception using errcode = '22023', message = 'ยังไม่สามารถเพิ่มค่าความสัมพันธ์ได้';
  end if;

  next_points := pet_record.relationship_points + applied_points;

  update public.pets
  set relationship_points = next_points
  where id = target_pet;

  update public.pet_tap_windows
  set tap_count = tap_count + 1,
      points_earned = points_earned + applied_points
  where pet_id = target_pet and user_id = (select auth.uid())
  returning * into window_record;

  insert into public.pet_relationship_actions(
    pet_id, actor_id, source, delta, points_after, note
  ) values (
    target_pet,
    (select auth.uid()),
    'tap',
    applied_points,
    next_points,
    'กิจกรรมแตะสัตว์เลี้ยง'
  );

  return jsonb_build_object(
    'gained', applied_points,
    'used', window_record.tap_count,
    'limit', pet_record.tap_limit,
    'reset_at', reset_at,
    'relationship_points', next_points,
    'relationship_max', pet_record.relationship_max
  );
end;
$$;

revoke all on function private.pet_can_manage_campaign(uuid) from public, anon;
revoke all on function private.pet_owns_character(uuid) from public, anon;
revoke all on function private.pet_can_view_character(uuid) from public, anon;
revoke all on function private.pet_can_view(uuid) from public, anon;
revoke all on function private.pet_can_manage(uuid) from public, anon;
revoke all on function private.pet_storage_pet_id(text) from public, anon;
revoke all on function private.pet_storage_can_create(text) from public, anon;
revoke all on function private.pet_storage_can_cleanup(text) from public, anon;
revoke all on function private.pet_assign_current_campaign() from public, anon, authenticated;
revoke all on function private.pet_sync_character_campaign() from public, anon, authenticated;
revoke all on function private.pet_set_updated_at() from public, anon, authenticated;

grant execute on function private.pet_can_manage_campaign(uuid) to authenticated;
grant execute on function private.pet_owns_character(uuid) to authenticated;
grant execute on function private.pet_can_view_character(uuid) to authenticated;
grant execute on function private.pet_can_view(uuid) to authenticated;
grant execute on function private.pet_can_manage(uuid) to authenticated;
grant execute on function private.pet_storage_pet_id(text) to authenticated;
grant execute on function private.pet_storage_can_create(text) to authenticated;
grant execute on function private.pet_storage_can_cleanup(text) to authenticated;

revoke all on function public.create_pet_request(uuid, uuid, uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.update_pet_request(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.resolve_pet_request(uuid, text, text) from public, anon;
revoke all on function public.set_active_pet(uuid) from public, anon;
revoke all on function public.set_character_pet_limit(uuid, integer) from public, anon;
revoke all on function public.update_pet_profile_dm(uuid, jsonb) from public, anon;
revoke all on function public.configure_pet_relationship(uuid, boolean, integer, integer, integer, integer, integer) from public, anon;
revoke all on function public.adjust_pet_relationship(uuid, integer, text) from public, anon;
revoke all on function public.get_pet_tap_status(uuid) from public, anon;
revoke all on function public.tap_pet_relationship(uuid) from public, anon;

grant select on public.character_pet_settings to authenticated;
grant select on public.pets to authenticated;
grant select on public.pet_forms to authenticated;
grant select on public.pet_unlocked_forms to authenticated;
grant select, insert, update, delete on public.pet_skills to authenticated;
grant select on public.pet_tap_windows to authenticated;
grant select on public.pet_relationship_actions to authenticated;
grant select on public.pet_evolution_requests to authenticated;
grant select on public.pet_evolution_events to authenticated;
grant select on public.pet_evolution_receipts to authenticated;

grant execute on function public.create_pet_request(uuid, uuid, uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_pet_request(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.resolve_pet_request(uuid, text, text) to authenticated;
grant execute on function public.set_active_pet(uuid) to authenticated;
grant execute on function public.set_character_pet_limit(uuid, integer) to authenticated;
grant execute on function public.update_pet_profile_dm(uuid, jsonb) to authenticated;
grant execute on function public.configure_pet_relationship(uuid, boolean, integer, integer, integer, integer, integer) to authenticated;
grant execute on function public.adjust_pet_relationship(uuid, integer, text) to authenticated;
grant execute on function public.get_pet_tap_status(uuid) to authenticated;
grant execute on function public.tap_pet_relationship(uuid) to authenticated;

comment on table public.pets is 'Pet requests and approved pets owned by campaign characters.';
comment on function public.tap_pet_relationship(uuid) is 'Server-authoritative relationship tap with configurable window, random points, and anti-spam enforcement.';
comment on table public.pet_evolution_events is 'Evolution/reversion events reserved for the global cinematic system in later phases.';
