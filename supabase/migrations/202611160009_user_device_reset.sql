create or replace function public.reset_my_key_device(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'user' then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set device_hash = null, device_bound_at = null
 where id = p_key_id and assigned_to = uid and status = 'redeemed';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.device_reset', p_key_id, '{"source":"web"}'::jsonb);
end
$$;
revoke all on function public.reset_my_key_device(uuid) from public, anon;
grant execute on function public.reset_my_key_device(uuid) to authenticated;
notify pgrst, 'reload schema';
