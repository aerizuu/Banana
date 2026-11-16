-- Backfill roles for the current authenticated Discord account after its ID is allowlisted.
update public.profiles p
set role = 'admin', updated_at = now()
where p.discord_id in (select a.discord_id from public.admin_allowlist a);

-- Ensure Discord identity writes always apply trusted allowlist role.
create or replace function public.sync_discord_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare discord_name text;
begin
 if new.provider = 'discord' then
  discord_name := coalesce(new.identity_data->>'preferred_username', new.identity_data->>'username');
  update public.profiles set discord_id = new.provider_id, discord_username = discord_name, updated_at = now()
  where id = new.user_id;
  if exists(select 1 from public.admin_allowlist a where a.discord_id = new.provider_id) then
   update public.profiles set role = 'admin', updated_at = now() where id = new.user_id;
  end if;
 end if;
 return new;
end
$$;
revoke all on function public.sync_discord_identity() from public, anon, authenticated;
