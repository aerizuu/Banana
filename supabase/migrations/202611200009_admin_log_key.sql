-- Admin Log Key: owner usernames for the all-keys view, plus admin-only
-- device reset and expired-key delete for any user's key.
create policy "admins read all profiles" on public.profiles for select to authenticated
using ((select role from public.profiles where id = (select auth.uid())) = 'admin');

create function public.admin_reset_key_device(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or (select role from public.profiles where id = uid) <> 'admin' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.keys set device_hash = null, device_bound_at = null
  where id = p_key_id and status = 'redeemed';
  if not found then raise exception 'key_unavailable'; end if;
  insert into public.audit_logs(actor_id, action, target_id, metadata)
  values (uid, 'key.device_reset', p_key_id, '{"source":"web-admin"}'::jsonb);
end
$$;
revoke all on function public.admin_reset_key_device(uuid) from public, anon;
grant execute on function public.admin_reset_key_device(uuid) to authenticated;

create function public.admin_delete_expired_key(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or (select role from public.profiles where id = uid) <> 'admin' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.keys set status = 'expired'
  where id = p_key_id and status = 'redeemed'
    and expires_at is not null and expires_at <= now();
  delete from public.keys where id = p_key_id and status = 'expired';
  if not found then raise exception 'key_unavailable'; end if;
  insert into public.audit_logs(actor_id, action, target_id, metadata)
  values (uid, 'key.deleted', p_key_id, '{"source":"web-admin"}'::jsonb);
end
$$;
revoke all on function public.admin_delete_expired_key(uuid) from public, anon;
grant execute on function public.admin_delete_expired_key(uuid) to authenticated;

notify pgrst, 'reload schema';
