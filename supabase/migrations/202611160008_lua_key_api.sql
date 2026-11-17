create or replace function public.lua_key_api(p_action text, p_key text, p_device_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare clean_key text := upper(trim(p_key)); target public.keys%rowtype; digest_value text;
begin
 if p_action not in ('validate', 'claim', 'reset') then raise exception 'invalid_action'; end if;
 if clean_key is null or length(clean_key) < 20 or length(clean_key) > 80 then raise exception 'invalid_key'; end if;
 if p_action <> 'reset' and (p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$') then raise exception 'invalid_device'; end if;
 digest_value := encode(extensions.digest(clean_key, 'sha256'), 'hex');
 select * into target from public.keys where key_hash = digest_value for update;
 if target.id is null or target.status = 'revoked' or target.status = 'available' then return jsonb_build_object('ok', false, 'code', 'KEY_NOT_FOUND', 'message', 'Key unavailable.'); end if;
 if target.expires_at is not null and target.expires_at <= now() then
  update public.keys set status = 'expired' where id = target.id;
  return jsonb_build_object('ok', false, 'code', 'KEY_EXPIRED', 'message', 'Key expired.');
 end if;
 if p_action = 'reset' then
  if target.device_hash is null then return jsonb_build_object('ok', false, 'code', 'NOT_BOUND', 'message', 'No device link to clear.'); end if;
  update public.keys set device_hash = null, device_bound_at = null where id = target.id;
  insert into public.audit_logs(actor_id, action, target_id, metadata) values(target.assigned_to, 'key.device_reset', target.id, '{"source":"lua"}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'OK', 'message', 'Device link cleared.');
 end if;
 if p_action = 'validate' and target.device_hash is null then return jsonb_build_object('ok', true, 'code', 'UNCLAIMED', 'message', 'Key is not linked.'); end if;
 if target.device_hash is not null and target.device_hash <> p_device_hash then return jsonb_build_object('ok', false, 'code', 'HWID_MISMATCH', 'message', 'Key is linked to another device.'); end if;
 if target.device_hash is null then
  update public.keys set device_hash = p_device_hash, device_bound_at = now() where id = target.id;
 end if;
 return jsonb_build_object('ok', true, 'code', 'OK', 'plan', target.duration, 'expiresAt', target.expires_at, 'lifetime', target.duration = 'lifetime');
end
$$;
revoke all on function public.lua_key_api(text, text, text) from public, anon, authenticated;
grant execute on function public.lua_key_api(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
