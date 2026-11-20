-- The admin profiles read policy must not subquery profiles under its own
-- RLS (infinite recursion). Use the security-definer role helper instead.
drop policy if exists "admins read all profiles" on public.profiles;
create policy "admins read all profiles" on public.profiles for select to authenticated
using (public.current_role() = 'admin');
