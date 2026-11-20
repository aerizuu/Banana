-- Second demo user with no keys, so the redeem flow can be exercised
-- end-to-end (the first demo user already holds active keys and the
-- one-active-key rule blocks further redeems). Login: user2 / user123.
do $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = 'user2@bananahub.local' limit 1;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      uid, 'authenticated', 'authenticated', 'user2@bananahub.local',
      extensions.crypt('user123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"user2"}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', 'user2@bananahub.local', 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  end if;
end $$;