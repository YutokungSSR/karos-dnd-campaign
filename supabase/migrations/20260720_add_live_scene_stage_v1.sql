-- Live Scene Stage V1
-- Draft scenes are visible only to Owner/DM. Players receive only the published snapshot.

create schema if not exists private;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'live-scene-assets',
  'live-scene-assets',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.live_scene_categories (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint live_scene_categories_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists live_scene_categories_campaign_name_idx
  on public.live_scene_categories (campaign_id, lower(btrim(name)));

create table if not exists public.live_scene_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  category_id uuid references public.live_scene_categories(id) on delete set null,
  name text not null,
  asset_type text not null default 'custom',
  storage_path text not null unique,
  original_filename text,
  mime_type text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint live_scene_assets_name_not_blank check (btrim(name) <> ''),
  constraint live_scene_assets_type_check check (
    asset_type in ('scene', 'character', 'monster', 'item', 'effect', 'custom')
  )
);

create index if not exists live_scene_assets_campaign_created_idx
  on public.live_scene_assets (campaign_id, created_at desc);

create table if not exists public.live_scenes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  background_asset_id uuid references public.live_scene_assets(id) on delete restrict,
  transition_color text not null default '#000000',
  transition_out_ms integer not null default 800,
  transition_hold_ms integer not null default 250,
  transition_in_ms integer not null default 900,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_scenes_name_not_blank check (btrim(name) <> ''),
  constraint live_scenes_transition_color_check check (
    transition_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  constraint live_scenes_transition_out_check check (transition_out_ms between 0 and 10000),
  constraint live_scenes_transition_hold_check check (transition_hold_ms between 0 and 10000),
  constraint live_scenes_transition_in_check check (transition_in_ms between 0 and 10000)
);

create index if not exists live_scenes_campaign_updated_idx
  on public.live_scenes (campaign_id, updated_at desc);

create table if not exists public.live_scene_objects (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.live_scenes(id) on delete cascade,
  asset_id uuid not null references public.live_scene_assets(id) on delete restrict,
  name text not null,
  object_type text not null default 'custom',
  x_pct numeric(7,3) not null default 50,
  y_pct numeric(7,3) not null default 50,
  width_pct numeric(7,3) not null default 24,
  rotation_deg numeric(8,3) not null default 0,
  z_index integer not null default 1,
  opacity numeric(5,4) not null default 1,
  flip_x boolean not null default false,
  visible boolean not null default true,
  enter_motion text not null default 'fade',
  exit_motion text not null default 'fade',
  motion_duration_ms integer not null default 650,
  motion_delay_ms integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_scene_objects_name_not_blank check (btrim(name) <> ''),
  constraint live_scene_objects_type_check check (
    object_type in ('scene', 'character', 'monster', 'item', 'effect', 'custom')
  ),
  constraint live_scene_objects_x_check check (x_pct between -25 and 125),
  constraint live_scene_objects_y_check check (y_pct between -25 and 125),
  constraint live_scene_objects_width_check check (width_pct between 2 and 150),
  constraint live_scene_objects_opacity_check check (opacity between 0 and 1),
  constraint live_scene_objects_enter_motion_check check (
    enter_motion in ('none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'scale')
  ),
  constraint live_scene_objects_exit_motion_check check (
    exit_motion in ('none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'scale')
  ),
  constraint live_scene_objects_motion_duration_check check (motion_duration_ms between 0 and 10000),
  constraint live_scene_objects_motion_delay_check check (motion_delay_ms between 0 and 30000)
);

create index if not exists live_scene_objects_scene_z_idx
  on public.live_scene_objects (scene_id, z_index, created_at);

create table if not exists public.live_scene_stage_state (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  draft_scene_id uuid references public.live_scenes(id) on delete set null,
  next_scene_id uuid references public.live_scenes(id) on delete set null,
  published_version bigint not null default 0,
  published_snapshot jsonb,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  editor_user_id uuid references auth.users(id) on delete set null,
  editor_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.live_scene_activity_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists live_scene_activity_logs_campaign_created_idx
  on public.live_scene_activity_logs (campaign_id, created_at desc);

create or replace function private.validate_live_scene_asset_category()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.category_id is not null and not exists (
    select 1
    from public.live_scene_categories category_row
    where category_row.id = new.category_id
      and category_row.campaign_id = new.campaign_id
  ) then
    raise exception 'หมวดหมู่ไม่ได้อยู่ในแคมเปญเดียวกับรูป';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_live_scene_asset_category_trigger
  on public.live_scene_assets;
create trigger validate_live_scene_asset_category_trigger
before insert or update of category_id, campaign_id
on public.live_scene_assets
for each row execute function private.validate_live_scene_asset_category();

create or replace function private.validate_live_scene_background()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.background_asset_id is not null and not exists (
    select 1
    from public.live_scene_assets asset_row
    where asset_row.id = new.background_asset_id
      and asset_row.campaign_id = new.campaign_id
  ) then
    raise exception 'ภาพพื้นหลังไม่ได้อยู่ในแคมเปญเดียวกับฉาก';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_live_scene_background_trigger
  on public.live_scenes;
create trigger validate_live_scene_background_trigger
before insert or update of background_asset_id, campaign_id
on public.live_scenes
for each row execute function private.validate_live_scene_background();

create or replace function private.validate_live_scene_object_asset()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.live_scenes scene_row
    join public.live_scene_assets asset_row
      on asset_row.id = new.asset_id
     and asset_row.campaign_id = scene_row.campaign_id
    where scene_row.id = new.scene_id
  ) then
    raise exception 'วัตถุและฉากไม่ได้อยู่ในแคมเปญเดียวกัน';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_live_scene_object_asset_trigger
  on public.live_scene_objects;
create trigger validate_live_scene_object_asset_trigger
before insert or update of scene_id, asset_id
on public.live_scene_objects
for each row execute function private.validate_live_scene_object_asset();

create or replace function private.live_scene_campaign_from_path(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $function$
declare
  first_part text;
begin
  first_part := split_part(object_name, '/', 1);
  if first_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return first_part::uuid;
  end if;
  return null;
exception
  when others then return null;
end;
$function$;

create or replace function private.has_live_scene_editor_lock(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and public.is_campaign_dm(target_campaign)
    and exists (
      select 1
      from public.live_scene_stage_state state_row
      where state_row.campaign_id = target_campaign
        and state_row.editor_user_id = (select auth.uid())
        and state_row.editor_expires_at > now()
    );
$function$;

create or replace function private.can_view_published_live_scene_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.live_scene_stage_state state_row
    where state_row.campaign_id = private.live_scene_campaign_from_path(object_name)
      and public.is_campaign_member(state_row.campaign_id)
      and state_row.published_snapshot is not null
      and (
        state_row.published_snapshot #>> '{background,storage_path}' = object_name
        or exists (
          select 1
          from jsonb_array_elements(
            coalesce(state_row.published_snapshot -> 'objects', '[]'::jsonb)
          ) object_row
          where object_row ->> 'storage_path' = object_name
        )
      )
  );
$function$;

alter table public.live_scene_categories enable row level security;
alter table public.live_scene_assets enable row level security;
alter table public.live_scenes enable row level security;
alter table public.live_scene_objects enable row level security;
alter table public.live_scene_stage_state enable row level security;
alter table public.live_scene_activity_logs enable row level security;

-- Draft library and editor data are DM-only.
drop policy if exists "live scene staff view categories" on public.live_scene_categories;
create policy "live scene staff view categories"
on public.live_scene_categories for select
using (public.is_campaign_dm(campaign_id));

drop policy if exists "live scene staff create categories" on public.live_scene_categories;
create policy "live scene staff create categories"
on public.live_scene_categories for insert
with check (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
  and created_by = auth.uid()
);

drop policy if exists "live scene staff update categories" on public.live_scene_categories;
create policy "live scene staff update categories"
on public.live_scene_categories for update
using (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
)
with check (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
);

drop policy if exists "live scene staff delete categories" on public.live_scene_categories;
create policy "live scene staff delete categories"
on public.live_scene_categories for delete
using (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
);

drop policy if exists "live scene staff view assets" on public.live_scene_assets;
create policy "live scene staff view assets"
on public.live_scene_assets for select
using (public.is_campaign_dm(campaign_id));

drop policy if exists "live scene staff create assets" on public.live_scene_assets;
create policy "live scene staff create assets"
on public.live_scene_assets for insert
with check (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
  and created_by = auth.uid()
);

drop policy if exists "live scene staff update assets" on public.live_scene_assets;
create policy "live scene staff update assets"
on public.live_scene_assets for update
using (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
)
with check (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
);

drop policy if exists "live scene staff view scenes" on public.live_scenes;
create policy "live scene staff view scenes"
on public.live_scenes for select
using (public.is_campaign_dm(campaign_id));

drop policy if exists "live scene staff create scenes" on public.live_scenes;
create policy "live scene staff create scenes"
on public.live_scenes for insert
with check (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

drop policy if exists "live scene staff update scenes" on public.live_scenes;
create policy "live scene staff update scenes"
on public.live_scenes for update
using (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
)
with check (
  public.is_campaign_dm(campaign_id)
  and private.has_live_scene_editor_lock(campaign_id)
  and updated_by = auth.uid()
);

drop policy if exists "live scene staff view objects" on public.live_scene_objects;
create policy "live scene staff view objects"
on public.live_scene_objects for select
using (
  exists (
    select 1
    from public.live_scenes scene_row
    where scene_row.id = scene_id
      and public.is_campaign_dm(scene_row.campaign_id)
  )
);

drop policy if exists "live scene staff create objects" on public.live_scene_objects;
create policy "live scene staff create objects"
on public.live_scene_objects for insert
with check (
  exists (
    select 1
    from public.live_scenes scene_row
    where scene_row.id = scene_id
      and public.is_campaign_dm(scene_row.campaign_id)
      and private.has_live_scene_editor_lock(scene_row.campaign_id)
  )
);

drop policy if exists "live scene staff update objects" on public.live_scene_objects;
create policy "live scene staff update objects"
on public.live_scene_objects for update
using (
  exists (
    select 1
    from public.live_scenes scene_row
    where scene_row.id = scene_id
      and public.is_campaign_dm(scene_row.campaign_id)
      and private.has_live_scene_editor_lock(scene_row.campaign_id)
  )
)
with check (
  exists (
    select 1
    from public.live_scenes scene_row
    where scene_row.id = scene_id
      and public.is_campaign_dm(scene_row.campaign_id)
      and private.has_live_scene_editor_lock(scene_row.campaign_id)
  )
);

drop policy if exists "live scene members view published state" on public.live_scene_stage_state;
create policy "live scene members view published state"
on public.live_scene_stage_state for select
using (public.is_campaign_member(campaign_id));

drop policy if exists "live scene staff view activity" on public.live_scene_activity_logs;
create policy "live scene staff view activity"
on public.live_scene_activity_logs for select
using (public.is_campaign_dm(campaign_id));

-- Private live-scene Storage. Members can read only files in the current published snapshot.
drop policy if exists "live scene members view published assets" on storage.objects;
create policy "live scene members view published assets"
on storage.objects for select
using (
  bucket_id = 'live-scene-assets'
  and (
    public.is_campaign_dm(private.live_scene_campaign_from_path(name))
    or private.can_view_published_live_scene_path(name)
  )
);

drop policy if exists "live scene staff upload assets" on storage.objects;
create policy "live scene staff upload assets"
on storage.objects for insert
with check (
  bucket_id = 'live-scene-assets'
  and private.has_live_scene_editor_lock(private.live_scene_campaign_from_path(name))
);

drop policy if exists "live scene staff update assets" on storage.objects;
create policy "live scene staff update assets"
on storage.objects for update
using (
  bucket_id = 'live-scene-assets'
  and private.has_live_scene_editor_lock(private.live_scene_campaign_from_path(name))
)
with check (
  bucket_id = 'live-scene-assets'
  and private.has_live_scene_editor_lock(private.live_scene_campaign_from_path(name))
);

drop policy if exists "live scene staff delete assets" on storage.objects;
create policy "live scene staff delete assets"
on storage.objects for delete
using (
  bucket_id = 'live-scene-assets'
  and private.has_live_scene_editor_lock(private.live_scene_campaign_from_path(name))
);

create or replace function public.acquire_live_scene_lock(
  target_campaign uuid,
  lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  current_editor uuid;
  current_expires timestamptz;
  editor_name text;
  safe_lease integer := greatest(45, least(coalesce(lease_seconds, 90), 300));
begin
  if current_user_id is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนเปิด DM Studio';
  end if;
  if not public.is_campaign_dm(target_campaign) then
    raise exception 'เฉพาะ Owner หรือ DM เท่านั้นที่เปิด DM Studio ได้';
  end if;

  insert into public.live_scene_stage_state (campaign_id)
  values (target_campaign)
  on conflict (campaign_id) do nothing;

  update public.live_scene_stage_state
  set
    editor_user_id = current_user_id,
    editor_expires_at = now() + make_interval(secs => safe_lease),
    updated_at = now()
  where campaign_id = target_campaign
    and (
      editor_user_id is null
      or editor_expires_at is null
      or editor_expires_at <= now()
      or editor_user_id = current_user_id
    );

  select editor_user_id, editor_expires_at
  into current_editor, current_expires
  from public.live_scene_stage_state
  where campaign_id = target_campaign;

  select profile.display_name
  into editor_name
  from public.profiles profile
  where profile.id = current_editor;

  return jsonb_build_object(
    'acquired', current_editor = current_user_id,
    'editor_user_id', current_editor,
    'editor_name', coalesce(editor_name, 'Dungeon Master'),
    'expires_at', current_expires
  );
end;
$function$;

create or replace function public.heartbeat_live_scene_lock(
  target_campaign uuid,
  lease_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
  safe_lease integer := greatest(45, least(coalesce(lease_seconds, 90), 300));
begin
  update public.live_scene_stage_state
  set
    editor_expires_at = now() + make_interval(secs => safe_lease),
    updated_at = now()
  where campaign_id = target_campaign
    and editor_user_id = auth.uid();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

create or replace function public.release_live_scene_lock(target_campaign uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  update public.live_scene_stage_state
  set editor_user_id = null, editor_expires_at = null, updated_at = now()
  where campaign_id = target_campaign
    and editor_user_id = auth.uid();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

create or replace function public.ensure_live_scene_stage(target_campaign uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  default_scene_id uuid;
begin
  if not private.has_live_scene_editor_lock(target_campaign) then
    raise exception 'กรุณาเปิดและครอบครอง DM Studio ก่อน';
  end if;

  insert into public.live_scene_stage_state (campaign_id)
  values (target_campaign)
  on conflict (campaign_id) do nothing;

  insert into public.live_scene_categories (campaign_id, name, created_by)
  values
    (target_campaign, 'ฉากและแผนที่', auth.uid()),
    (target_campaign, 'ตัวละคร', auth.uid()),
    (target_campaign, 'มอนสเตอร์', auth.uid()),
    (target_campaign, 'ไอเทม', auth.uid()),
    (target_campaign, 'เอฟเฟกต์', auth.uid())
  on conflict do nothing;

  select draft_scene_id into default_scene_id
  from public.live_scene_stage_state
  where campaign_id = target_campaign;

  if default_scene_id is null then
    insert into public.live_scenes (
      campaign_id, name, created_by, updated_by
    )
    values (
      target_campaign, 'ฉากเริ่มต้น', auth.uid(), auth.uid()
    )
    returning id into default_scene_id;

    update public.live_scene_stage_state
    set draft_scene_id = default_scene_id, updated_at = now()
    where campaign_id = target_campaign;
  end if;

  return default_scene_id;
end;
$function$;

create or replace function public.set_live_scene_draft(
  target_campaign uuid,
  target_scene uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_live_scene_editor_lock(target_campaign) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;
  if not exists (
    select 1 from public.live_scenes
    where id = target_scene and campaign_id = target_campaign
  ) then
    raise exception 'ไม่พบฉากในแคมเปญนี้';
  end if;
  update public.live_scene_stage_state
  set draft_scene_id = target_scene, updated_at = now()
  where campaign_id = target_campaign;
  return true;
end;
$function$;

create or replace function public.set_live_scene_next(
  target_campaign uuid,
  target_scene uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_live_scene_editor_lock(target_campaign) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;
  if not exists (
    select 1 from public.live_scenes
    where id = target_scene and campaign_id = target_campaign
  ) then
    raise exception 'ไม่พบฉากในแคมเปญนี้';
  end if;
  update public.live_scene_stage_state
  set next_scene_id = target_scene, updated_at = now()
  where campaign_id = target_campaign;
  return true;
end;
$function$;

create or replace function public.publish_live_scene(
  target_campaign uuid,
  source_scene uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  scene_row public.live_scenes%rowtype;
  background_json jsonb;
  objects_json jsonb;
  next_version bigint;
begin
  if not private.has_live_scene_editor_lock(target_campaign) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;

  select * into scene_row
  from public.live_scenes
  where id = source_scene and campaign_id = target_campaign;

  if scene_row.id is null then
    raise exception 'ไม่พบฉากที่ต้องการเผยแพร่';
  end if;

  if scene_row.background_asset_id is null then
    background_json := null;
  else
    select jsonb_build_object(
      'asset_id', asset.id,
      'name', asset.name,
      'asset_type', asset.asset_type,
      'storage_path', asset.storage_path
    )
    into background_json
    from public.live_scene_assets asset
    where asset.id = scene_row.background_asset_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', object_row.id,
        'asset_id', asset.id,
        'name', object_row.name,
        'object_type', object_row.object_type,
        'storage_path', asset.storage_path,
        'x_pct', object_row.x_pct,
        'y_pct', object_row.y_pct,
        'width_pct', object_row.width_pct,
        'rotation_deg', object_row.rotation_deg,
        'z_index', object_row.z_index,
        'opacity', object_row.opacity,
        'flip_x', object_row.flip_x,
        'visible', object_row.visible,
        'enter_motion', object_row.enter_motion,
        'exit_motion', object_row.exit_motion,
        'motion_duration_ms', object_row.motion_duration_ms,
        'motion_delay_ms', object_row.motion_delay_ms
      )
      order by object_row.z_index, object_row.created_at
    ),
    '[]'::jsonb
  )
  into objects_json
  from public.live_scene_objects object_row
  join public.live_scene_assets asset on asset.id = object_row.asset_id
  where object_row.scene_id = source_scene
    and object_row.visible = true;

  update public.live_scene_stage_state
  set
    draft_scene_id = source_scene,
    next_scene_id = case when next_scene_id = source_scene then null else next_scene_id end,
    published_version = published_version + 1,
    published_snapshot = jsonb_build_object(
      'source_scene_id', scene_row.id,
      'scene_name', scene_row.name,
      'background', background_json,
      'transition', jsonb_build_object(
        'color', scene_row.transition_color,
        'out_ms', scene_row.transition_out_ms,
        'hold_ms', scene_row.transition_hold_ms,
        'in_ms', scene_row.transition_in_ms
      ),
      'objects', objects_json
    ),
    published_at = now(),
    published_by = auth.uid(),
    updated_at = now()
  where campaign_id = target_campaign
  returning published_version into next_version;

  insert into public.live_scene_activity_logs (
    campaign_id, actor_id, action, entity_type, entity_id, entity_name,
    metadata
  )
  values (
    target_campaign, auth.uid(), 'publish', 'scene', scene_row.id, scene_row.name,
    jsonb_build_object('published_version', next_version)
  );

  return next_version;
end;
$function$;

create or replace function public.delete_live_scene_object(target_object uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  object_row public.live_scene_objects%rowtype;
  campaign_value uuid;
begin
  select * into object_row
  from public.live_scene_objects
  where id = target_object;

  if object_row.id is null then return false; end if;

  select scene_row.campaign_id into campaign_value
  from public.live_scenes scene_row
  where scene_row.id = object_row.scene_id;
  if not private.has_live_scene_editor_lock(campaign_value) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;

  delete from public.live_scene_objects where id = target_object;
  insert into public.live_scene_activity_logs (
    campaign_id, actor_id, action, entity_type, entity_id, entity_name
  ) values (
    campaign_value, auth.uid(), 'delete', 'object', object_row.id, object_row.name
  );
  return true;
end;
$function$;

create or replace function public.delete_live_scene_category(target_category uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  category_row public.live_scene_categories%rowtype;
begin
  select * into category_row
  from public.live_scene_categories
  where id = target_category;
  if category_row.id is null then return false; end if;
  if not private.has_live_scene_editor_lock(category_row.campaign_id) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;

  delete from public.live_scene_categories where id = target_category;
  insert into public.live_scene_activity_logs (
    campaign_id, actor_id, action, entity_type, entity_id, entity_name
  ) values (
    category_row.campaign_id, auth.uid(), 'delete', 'category',
    category_row.id, category_row.name
  );
  return true;
end;
$function$;

create or replace function public.delete_live_scene_asset(target_asset uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  asset_row public.live_scene_assets%rowtype;
begin
  select * into asset_row
  from public.live_scene_assets
  where id = target_asset;
  if asset_row.id is null then return null; end if;
  if not private.has_live_scene_editor_lock(asset_row.campaign_id) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;

  if exists (
    select 1 from public.live_scenes where background_asset_id = target_asset
  ) or exists (
    select 1 from public.live_scene_objects where asset_id = target_asset
  ) or exists (
    select 1
    from public.live_scene_stage_state state_row
    where state_row.campaign_id = asset_row.campaign_id
      and state_row.published_snapshot is not null
      and (
        state_row.published_snapshot #>> '{background,asset_id}' = target_asset::text
        or exists (
          select 1
          from jsonb_array_elements(
            coalesce(state_row.published_snapshot -> 'objects', '[]'::jsonb)
          ) object_row
          where object_row ->> 'asset_id' = target_asset::text
        )
      )
  ) then
    raise exception 'ไม่สามารถลบรูปนี้ได้ เพราะยังถูกใช้ในฉากหรือฉากที่กำลังแสดง';
  end if;

  delete from public.live_scene_assets where id = target_asset;
  insert into public.live_scene_activity_logs (
    campaign_id, actor_id, action, entity_type, entity_id, entity_name,
    metadata
  ) values (
    asset_row.campaign_id, auth.uid(), 'delete', 'asset', asset_row.id,
    asset_row.name, jsonb_build_object('storage_path', asset_row.storage_path)
  );
  return asset_row.storage_path;
end;
$function$;

create or replace function public.delete_live_scene(target_scene uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  scene_row public.live_scenes%rowtype;
begin
  select * into scene_row
  from public.live_scenes
  where id = target_scene;
  if scene_row.id is null then return false; end if;
  if not private.has_live_scene_editor_lock(scene_row.campaign_id) then
    raise exception 'คุณไม่ได้ครอบครอง DM Studio';
  end if;

  if exists (
    select 1
    from public.live_scene_stage_state state_row
    where state_row.campaign_id = scene_row.campaign_id
      and state_row.published_snapshot ->> 'source_scene_id' = target_scene::text
  ) then
    raise exception 'ไม่สามารถลบฉากที่กำลังแสดงแก่ผู้เล่นได้ กรุณาเผยแพร่ฉากอื่นก่อน';
  end if;

  delete from public.live_scenes where id = target_scene;
  insert into public.live_scene_activity_logs (
    campaign_id, actor_id, action, entity_type, entity_id, entity_name
  ) values (
    scene_row.campaign_id, auth.uid(), 'delete', 'scene', scene_row.id, scene_row.name
  );
  return true;
end;
$function$;

revoke all on function public.acquire_live_scene_lock(uuid, integer) from public;
revoke all on function public.heartbeat_live_scene_lock(uuid, integer) from public;
revoke all on function public.release_live_scene_lock(uuid) from public;
revoke all on function public.ensure_live_scene_stage(uuid) from public;
revoke all on function public.set_live_scene_draft(uuid, uuid) from public;
revoke all on function public.set_live_scene_next(uuid, uuid) from public;
revoke all on function public.publish_live_scene(uuid, uuid) from public;
revoke all on function public.delete_live_scene_object(uuid) from public;
revoke all on function public.delete_live_scene_category(uuid) from public;
revoke all on function public.delete_live_scene_asset(uuid) from public;
revoke all on function public.delete_live_scene(uuid) from public;

grant execute on function public.acquire_live_scene_lock(uuid, integer) to authenticated;
grant execute on function public.heartbeat_live_scene_lock(uuid, integer) to authenticated;
grant execute on function public.release_live_scene_lock(uuid) to authenticated;
grant execute on function public.ensure_live_scene_stage(uuid) to authenticated;
grant execute on function public.set_live_scene_draft(uuid, uuid) to authenticated;
grant execute on function public.set_live_scene_next(uuid, uuid) to authenticated;
grant execute on function public.publish_live_scene(uuid, uuid) to authenticated;
grant execute on function public.delete_live_scene_object(uuid) to authenticated;
grant execute on function public.delete_live_scene_category(uuid) to authenticated;
grant execute on function public.delete_live_scene_asset(uuid) to authenticated;
grant execute on function public.delete_live_scene(uuid) to authenticated;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_scene_stage_state'
    ) then
      alter publication supabase_realtime add table public.live_scene_stage_state;
    end if;
  end if;
end;
$publication$;
