-- Allow a newly inserted character to pass INSERT ... RETURNING without
-- broadening access beyond the character owner. The existing SELECT policy
-- re-queries public.characters through a STABLE helper, which cannot see the
-- row created in the same statement snapshot.

begin;

drop policy if exists "owners view own characters directly"
on public.characters;

create policy "owners view own characters directly"
on public.characters
for select
to authenticated
using (
  (select auth.uid()) is not null
  and owner_id = (select auth.uid())
);

commit;
