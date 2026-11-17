create or replace function public.generate_key(p_duration public.key_duration) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); raw_key text; key_id uuid; expiry timestamptz;
begin
 if uid is null or not public.is_staff() then
  raise exception 'not_authorized' using errcode = '42501';
 end if;
 if p_duration not in ('24h', '7d', '30d', 'lifetime') then
  raise exception 'invalid_duration';
 end if;
 raw_key := 'BH-' || upper(encode(extensions.gen_random_bytes(24), 'hex'));
 expiry := case p_duration
  when '24h' then now() + interval '24 hours'
  when '7d' then now() + interval '7 days'
  when '30d' then now() + interval '30 days'
  else null
 end;
 insert into public.keys(key_hash, key_prefix, generated_by, duration, expires_at)
 values (encode(extensions.digest(raw_key, 'sha256'), 'hex'), left(raw_key, 11), uid, p_duration, expiry)
 returning id into key_id;
 insert into public.audit_logs(actor_id, action, target_id, metadata)
 values (uid, 'key.generated', key_id, jsonb_build_object('duration', p_duration));
 return jsonb_build_object('id', key_id, 'key', raw_key, 'duration', p_duration, 'expires_at', expiry);
end
$$;
revoke all on function public.generate_key(public.key_duration) from public, anon;
grant execute on function public.generate_key(public.key_duration) to authenticated;
notify pgrst, 'reload schema';
