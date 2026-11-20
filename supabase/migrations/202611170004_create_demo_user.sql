-- Create or update demo user account for instant login
do $$
declare
  demo_id uuid;
begin
  select id into demo_id from auth.users where email in ('userdemo@bananahub.com', 'user@bananahub.com') limit 1;

  if demo_id is not null then
    update auth.users
    set email_confirmed_at = now(),
        encrypted_password = extensions.crypt('user123', extensions.gen_salt('bf')),
        raw_user_meta_data = '{"username":"user"}'::jsonb
    where id = demo_id;
  else
    demo_id := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      demo_id,
      'authenticated',
      'authenticated',
      'userdemo@bananahub.com',
      extensions.crypt('user123', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"user"}'::jsonb,
      now(),
      now()
    );
  end if;

  insert into public.profiles (id, username, role)
  values (demo_id, 'user', 'user')
  on conflict (id) do update set username = 'user', role = 'user';
end;
$$;
