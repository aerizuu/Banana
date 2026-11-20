-- The appearance policy's WITH CHECK subqueries profiles itself, so every
-- client UPDATE dies with 42P17 (infinite recursion) and theme sync silently
-- fails. Column privileges protect the immutable columns instead; the policy
-- only checks row ownership. Discord/role writes happen in SECURITY DEFINER
-- triggers, which bypass both RLS and column grants.
drop policy if exists "profile update appearance self" on public.profiles;
create policy "profile update self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke update on public.profiles from authenticated;
grant update (preferred_theme) on public.profiles to authenticated;
