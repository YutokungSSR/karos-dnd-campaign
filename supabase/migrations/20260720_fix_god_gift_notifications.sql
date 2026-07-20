create index if not exists god_gift_notifications_campaign_unread_idx
  on public.god_gift_notifications(campaign_id, created_at asc)
  where read_at is null;

create or replace function public.claim_god_gift_notifications(
  target_campaign uuid default null,
  target_character uuid default null,
  max_rows integer default 10
)
returns setof public.god_gift_notifications
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  with candidates as (
    select notification.id
    from public.god_gift_notifications notification
    join public.characters character_row
      on character_row.id = notification.recipient_character_id
    where notification.read_at is null
      and character_row.owner_id = auth.uid()
      and (
        target_campaign is null
        or notification.campaign_id = target_campaign
      )
      and (
        target_character is null
        or notification.recipient_character_id = target_character
      )
    order by notification.created_at asc
    limit greatest(1, least(coalesce(max_rows, 10), 50))
    for update of notification skip locked
  )
  update public.god_gift_notifications notification
  set read_at = now()
  from candidates
  where notification.id = candidates.id
  returning notification.*;
end;
$function$;

revoke all on function public.claim_god_gift_notifications(uuid, uuid, integer)
  from public;

grant execute on function public.claim_god_gift_notifications(uuid, uuid, integer)
  to authenticated;
