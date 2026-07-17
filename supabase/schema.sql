-- Karos D&D Campaign — Supabase schema
-- Run this entire file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'นักผจญภัย',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  dm_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  invite_code text not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)) unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player' check (role in ('dm','player')),
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  title text not null default '',
  class_name text not null default '',
  level integer not null default 1 check (level >= 1),
  rank text not null default 'F',
  element text not null default '',
  race text not null default 'มนุษย์',
  stars text not null default '★',
  condition_text text not null default 'ปกติ',
  memory text not null default '',
  portrait_url text,
  current_hp integer not null default 20 check (current_hp >= 0),
  max_hp integer not null default 20 check (max_hp >= 1),
  current_mp integer not null default 10 check (current_mp >= 0),
  max_mp integer not null default 10 check (max_mp >= 0),
  stats jsonb not null default '{"STR":10,"VIT":10,"AGI":10,"INT":10,"DEX":10,"WIS":10,"CHA":10}'::jsonb,
  is_public boolean not null default false,
  share_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  skill_type text not null default 'ทั่วไป',
  description text not null default '',
  cost text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  item_type text not null default 'ไอเทม',
  quantity integer not null default 1 check (quantity >= 0),
  description text not null default '',
  equipped boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.conditions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  description text not null default '',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.dice_rolls (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  expression text not null,
  result integer not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_campaign_members_user on public.campaign_members(user_id);
create index if not exists idx_characters_owner on public.characters(owner_id);
create index if not exists idx_characters_campaign on public.characters(campaign_id);
create index if not exists idx_skills_character on public.skills(character_id);
create index if not exists idx_items_character on public.inventory_items(character_id);
create index if not exists idx_conditions_character on public.conditions(character_id);
create index if not exists idx_rolls_campaign_created on public.dice_rolls(campaign_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists campaigns_updated_at on public.campaigns;
create trigger campaigns_updated_at before update on public.campaigns for each row execute function public.set_updated_at();
drop trigger if exists characters_updated_at on public.characters;
create trigger characters_updated_at before update on public.characters for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'นักผจญภัย'))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.add_dm_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.campaign_members (campaign_id, user_id, role)
  values (new.id, new.dm_user_id, 'dm')
  on conflict (campaign_id, user_id) do update set role = 'dm';
  return new;
end; $$;

drop trigger if exists campaign_add_dm_member on public.campaigns;
create trigger campaign_add_dm_member after insert on public.campaigns for each row execute function public.add_dm_as_member();

create or replace function public.is_campaign_member(target_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.campaign_members where campaign_id = target_campaign and user_id = auth.uid());
$$;

create or replace function public.is_campaign_dm(target_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.campaigns where id = target_campaign and dm_user_id = auth.uid());
$$;

create or replace function public.can_view_character(target_character uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.characters c
    where c.id = target_character
      and (c.is_public or c.owner_id = auth.uid() or (c.campaign_id is not null and public.is_campaign_member(c.campaign_id)))
  );
$$;

create or replace function public.can_edit_character(target_character uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.characters c
    where c.id = target_character
      and (c.owner_id = auth.uid() or (c.campaign_id is not null and public.is_campaign_dm(c.campaign_id)))
  );
$$;

create or replace function public.join_campaign_by_code(code_input text)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  select id into target_id from public.campaigns where upper(invite_code) = upper(trim(code_input));
  if target_id is null then raise exception 'ไม่พบรหัสเชิญนี้'; end if;
  insert into public.campaign_members(campaign_id, user_id, role)
  values(target_id, auth.uid(), 'player')
  on conflict(campaign_id, user_id) do nothing;
  return target_id;
end; $$;

grant execute on function public.join_campaign_by_code(text) to authenticated;
grant execute on function public.is_campaign_member(uuid) to authenticated;
grant execute on function public.is_campaign_dm(uuid) to authenticated;
grant execute on function public.can_view_character(uuid) to anon, authenticated;
grant execute on function public.can_edit_character(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.characters enable row level security;
alter table public.skills enable row level security;
alter table public.inventory_items enable row level security;
alter table public.conditions enable row level security;
alter table public.dice_rolls enable row level security;

-- Drop policies so this script can be safely re-run.
do $$ declare pol record; begin
  for pol in select schemaname, tablename, policyname from pg_policies where schemaname='public' and tablename in ('profiles','campaigns','campaign_members','characters','skills','inventory_items','conditions','dice_rolls') loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

create policy "profiles readable by signed users" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members view campaigns" on public.campaigns for select to authenticated using (public.is_campaign_member(id));
create policy "users create own campaigns" on public.campaigns for insert to authenticated with check (dm_user_id = auth.uid());
create policy "dm updates campaign" on public.campaigns for update to authenticated using (dm_user_id = auth.uid()) with check (dm_user_id = auth.uid());
create policy "dm deletes campaign" on public.campaigns for delete to authenticated using (dm_user_id = auth.uid());

create policy "members view members" on public.campaign_members for select to authenticated using (public.is_campaign_member(campaign_id));
create policy "dm adds members" on public.campaign_members for insert to authenticated with check (public.is_campaign_dm(campaign_id));
create policy "dm or self removes membership" on public.campaign_members for delete to authenticated using (public.is_campaign_dm(campaign_id) or user_id = auth.uid());
create policy "dm changes roles" on public.campaign_members for update to authenticated using (public.is_campaign_dm(campaign_id)) with check (public.is_campaign_dm(campaign_id));

create policy "view permitted characters" on public.characters for select to anon, authenticated using (public.can_view_character(id));
create policy "create own character" on public.characters for insert to authenticated with check (owner_id = auth.uid() and (campaign_id is null or public.is_campaign_member(campaign_id)));
create policy "owner or dm updates character" on public.characters for update to authenticated using (public.can_edit_character(id)) with check (owner_id = auth.uid() or (campaign_id is not null and public.is_campaign_dm(campaign_id)));
create policy "owner or dm deletes character" on public.characters for delete to authenticated using (public.can_edit_character(id));

create policy "view permitted skills" on public.skills for select to anon, authenticated using (public.can_view_character(character_id));
create policy "edit permitted skills insert" on public.skills for insert to authenticated with check (public.can_edit_character(character_id));
create policy "edit permitted skills update" on public.skills for update to authenticated using (public.can_edit_character(character_id)) with check (public.can_edit_character(character_id));
create policy "edit permitted skills delete" on public.skills for delete to authenticated using (public.can_edit_character(character_id));

create policy "view permitted items" on public.inventory_items for select to anon, authenticated using (public.can_view_character(character_id));
create policy "edit permitted items insert" on public.inventory_items for insert to authenticated with check (public.can_edit_character(character_id));
create policy "edit permitted items update" on public.inventory_items for update to authenticated using (public.can_edit_character(character_id)) with check (public.can_edit_character(character_id));
create policy "edit permitted items delete" on public.inventory_items for delete to authenticated using (public.can_edit_character(character_id));

create policy "view permitted conditions" on public.conditions for select to anon, authenticated using (public.can_view_character(character_id));
create policy "edit permitted conditions insert" on public.conditions for insert to authenticated with check (public.can_edit_character(character_id));
create policy "edit permitted conditions update" on public.conditions for update to authenticated using (public.can_edit_character(character_id)) with check (public.can_edit_character(character_id));
create policy "edit permitted conditions delete" on public.conditions for delete to authenticated using (public.can_edit_character(character_id));

create policy "members view dice rolls" on public.dice_rolls for select to authenticated using (public.is_campaign_member(campaign_id));
create policy "members create own dice rolls" on public.dice_rolls for insert to authenticated with check (user_id = auth.uid() and public.is_campaign_member(campaign_id));
create policy "dm deletes dice rolls" on public.dice_rolls for delete to authenticated using (public.is_campaign_dm(campaign_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-portraits', 'character-portraits', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true, file_size_limit=5242880, allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

-- Storage policies
DROP POLICY IF EXISTS "portrait uploads in own folder" ON storage.objects;
DROP POLICY IF EXISTS "portrait updates in own folder" ON storage.objects;
DROP POLICY IF EXISTS "portrait deletes in own folder" ON storage.objects;
create policy "portrait uploads in own folder" on storage.objects for insert to authenticated with check (bucket_id='character-portraits' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "portrait updates in own folder" on storage.objects for update to authenticated using (bucket_id='character-portraits' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='character-portraits' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "portrait deletes in own folder" on storage.objects for delete to authenticated using (bucket_id='character-portraits' and (storage.foldername(name))[1]=auth.uid()::text);

-- Enable Realtime for party HP and dice history.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='characters') then
    alter publication supabase_realtime add table public.characters;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dice_rolls') then
    alter publication supabase_realtime add table public.dice_rolls;
  end if;
end $$;
