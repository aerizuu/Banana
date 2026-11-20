-- Demo staff (developer) account + demo keys covering every UI state:
-- redeemed+bound, redeemed unbound lifetime, expired, revoked.
-- Login: staff / staff123. Keys belong to the existing demo user.
do $$
declare
  staff_id uuid;
  demo_id uuid;
  raw_key text;
begin
  select id into staff_id from auth.users where email = 'staffdemo@bananahub.com' limit 1;
  if staff_id is null then
    staff_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      staff_id, 'authenticated', 'authenticated', 'staffdemo@bananahub.com',
      extensions.crypt('staff123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"staff"}'::jsonb, now(), now()
    );
  else
    update auth.users
    set email_confirmed_at = now(),
        encrypted_password = extensions.crypt('staff123', extensions.gen_salt('bf')),
        raw_user_meta_data = '{"username":"staff"}'::jsonb
    where id = staff_id;
  end if;

  insert into public.profiles (id, username, role)
  values (staff_id, 'staff', 'developer')
  on conflict (id) do update set username = 'staff', role = 'developer';

  select id into demo_id from auth.users where email in ('userdemo@bananahub.com', 'user@bananahub.com') limit 1;
  if demo_id is null then
    raise exception 'demo user missing; run 202611170004 first';
  end if;

  -- Redeemed 7d key, device-bound: exercises detail modal + Reset Device.
  if not exists (select 1 from public.keys where generated_by = staff_id and key_prefix = 'BH-DEMO0001') then
    raw_key := 'BH-DEMO0001' || upper(encode(extensions.gen_random_bytes(20), 'hex'));
    insert into public.keys (key_hash, key_prefix, generated_by, assigned_to, duration, status, redeemed_at, expires_at, device_hash, device_bound_at)
    values (encode(extensions.digest(raw_key, 'sha256'), 'hex'), 'BH-DEMO0001', staff_id, demo_id, '7d', 'redeemed',
            now() - interval '1 day', now() + interval '6 days', repeat('a', 64), now() - interval '1 day');
  end if;

  -- Redeemed lifetime key, unbound: Reset Device must be disabled.
  if not exists (select 1 from public.keys where generated_by = staff_id and key_prefix = 'BH-DEMO0002') then
    raw_key := 'BH-DEMO0002' || upper(encode(extensions.gen_random_bytes(20), 'hex'));
    insert into public.keys (key_hash, key_prefix, generated_by, assigned_to, duration, status, redeemed_at, expires_at)
    values (encode(extensions.digest(raw_key, 'sha256'), 'hex'), 'BH-DEMO0002', staff_id, demo_id, 'lifetime', 'redeemed',
            now() - interval '2 days', null);
  end if;

  -- Expired 24h key.
  if not exists (select 1 from public.keys where generated_by = staff_id and key_prefix = 'BH-DEMO0003') then
    raw_key := 'BH-DEMO0003' || upper(encode(extensions.gen_random_bytes(20), 'hex'));
    insert into public.keys (key_hash, key_prefix, generated_by, assigned_to, duration, status, redeemed_at, expires_at)
    values (encode(extensions.digest(raw_key, 'sha256'), 'hex'), 'BH-DEMO0003', staff_id, demo_id, '24h', 'redeemed',
            now() - interval '2 days', now() - interval '1 day');
  end if;

  -- Revoked lifetime key.
  if not exists (select 1 from public.keys where generated_by = staff_id and key_prefix = 'BH-DEMO0004') then
    raw_key := 'BH-DEMO0004' || upper(encode(extensions.gen_random_bytes(20), 'hex'));
    insert into public.keys (key_hash, key_prefix, generated_by, duration, status, revoked_at, expires_at)
    values (encode(extensions.digest(raw_key, 'sha256'), 'hex'), 'BH-DEMO0004', staff_id, 'lifetime', 'revoked', now(), null);
  end if;
end;
$$;
