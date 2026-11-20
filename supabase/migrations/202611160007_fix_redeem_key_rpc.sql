create or replace function public.redeem_key(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); row_key public.keys%rowtype; clean_key text;
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'user' then
  raise exception 'not_authorized' using errcode = '42501';
 end if;
 if exists (select 1 from public.keys where assigned_to = uid) then
  raise exception 'redeem_limit_reached';
 end if;
 clean_key := upper(trim(p_key));
 if clean_key is null or length(clean_key) < 20 or length(clean_key) > 80 then
  raise exception 'invalid_key';
 end if;
 update public.keys set status = 'expired'
 where key_hash = encode(extensions.digest(clean_key, 'sha256'), 'hex')
  and status = 'available' and expires_at is not null and expires_at <= now();
 update public.keys set status = 'redeemed', assigned_to = uid, redeemed_at = now()
 where key_hash = encode(extensions.digest(clean_key, 'sha256'), 'hex')
  and status = 'available' and (expires_at is null or expires_at > now())
 returning * into row_key;
 if row_key.id is null then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata)
 values(uid, 'key.redeemed', row_key.id, jsonb_build_object('duration', row_key.duration));
  return jsonb_build_object('id', row_key.id, 'key', clean_key, 'duration', row_key.duration, 'expires_at', row_key.expires_at, 'redeemed_at', row_key.redeemed_at);
end
$$;
create or replace function public.generate_key(p_duration public.key_duration) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); raw_key text; key_id uuid; expiry timestamptz;
begin
 if uid is null or not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
 if p_duration not in ('24h', '7d', '30d', 'lifetime') then raise exception 'invalid_duration'; end if;
 raw_key := 'BH-' || upper(encode(extensions.gen_random_bytes(24), 'hex'));
 expiry := case p_duration when '24h' then now() + interval '24 hours' when '7d' then now() + interval '7 days' when '30d' then now() + interval '30 days' else null end;
 insert into public.keys(key_hash, key_prefix, generated_by, duration, expires_at)
 values (encode(extensions.digest(raw_key, 'sha256'), 'hex'), left(raw_key, 11), uid, p_duration, expiry)
 returning id into key_id;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.generated', key_id, jsonb_build_object('duration', p_duration));
 return jsonb_build_object('id', key_id, 'key', raw_key, 'duration', p_duration, 'expires_at', expiry);
end
$$;
revoke all on function public.generate_key(public.key_duration) from public, anon;
grant execute on function public.generate_key(public.key_duration) to authenticated;
revoke all on function public.redeem_key(text) from public, anon;
grant execute on function public.redeem_key(text) to authenticated;
notify pgrst, 'reload schema';
