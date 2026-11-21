-- Add Discord IDs to the owner allowlist from the Admin page instead of the
-- SQL Editor. Entries keep the existing semantics: owner role at next Discord
-- sign-in (sync_discord_identity / ensure_my_profile).
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in ('key.generated', 'key.redeemed', 'key.revoked', 'key.deleted', 'key.device_reset', 'allowlist.added', 'account.theme_changed', 'account.discord_linked'));

create function public.add_discord_allowlist(p_discord_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); clean_id text;
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'owner' then
  raise exception 'not_authorized' using errcode = '42501';
 end if;
 clean_id := trim(p_discord_id);
 if clean_id !~ '^[0-9]{15,22}$' then raise exception 'invalid_id'; end if;
 if exists(select 1 from public.admin_allowlist where discord_id = clean_id) then
  raise exception 'already_listed';
 end if;
 insert into public.admin_allowlist(discord_id) values(clean_id);
 insert into public.audit_logs(actor_id, action, metadata)
 values(uid, 'allowlist.added', jsonb_build_object('discord_id', clean_id));
end
$$;
revoke all on function public.add_discord_allowlist(text) from public, anon;
grant execute on function public.add_discord_allowlist(text) to authenticated;

notify pgrst, 'reload schema';
