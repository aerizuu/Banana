-- Users can permanently delete their own expired keys.
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in ('key.generated', 'key.redeemed', 'key.revoked', 'key.deleted', 'key.device_reset', 'account.theme_changed', 'account.discord_linked'));

create or replace function public.delete_expired_key(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or (select role from public.profiles where id = uid) <> 'user' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Normalize keys that just passed their expiry but are still marked redeemed.
  update public.keys set status = 'expired'
  where id = p_key_id and assigned_to = uid and status = 'redeemed'
    and expires_at is not null and expires_at <= now();

  delete from public.keys
  where id = p_key_id and assigned_to = uid and status = 'expired';

  if not found then
    raise exception 'key_unavailable';
  end if;

  insert into public.audit_logs(actor_id, action, target_id)
  values (uid, 'key.deleted', p_key_id);
end;
$$;

revoke all on function public.delete_expired_key(uuid) from public, anon;
grant execute on function public.delete_expired_key(uuid) to authenticated;
notify pgrst, 'reload schema';
