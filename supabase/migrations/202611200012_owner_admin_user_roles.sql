-- Role model: Owner (full access), Admin (issue keys only), User (redeem).
-- Old 'admin' rows become owner, old 'developer' rows become admin.
update public.profiles set role = 'owner' where role = 'admin';
update public.profiles set role = 'admin' where role = 'developer';

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'owner'))
$$;

drop policy if exists "admins read assigned keys" on public.keys;
drop policy if exists "admins read all keys" on public.keys;
create policy "owners read assigned keys" on public.keys for select to authenticated
using (assigned_to = (select auth.uid()) and public.current_role() = 'owner');
create policy "owners read all keys" on public.keys for select to authenticated
using (public.current_role() = 'owner');

drop policy if exists "admins read all profiles" on public.profiles;
create policy "owners read all profiles" on public.profiles for select to authenticated
using (public.current_role() = 'owner');

create or replace function public.redeem_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  user_role public.app_role;
  row_key public.keys%rowtype;
  clean_key text;
begin
  if uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select role into user_role from public.profiles where id = uid;
  if user_role not in ('user', 'owner') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.keys
  set status = 'expired'
  where assigned_to = uid
    and status = 'redeemed'
    and expires_at is not null
    and expires_at <= now();

  if user_role = 'user' and exists (
    select 1 from public.keys
    where assigned_to = uid
      and status = 'redeemed'
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'redeem_limit_reached';
  end if;

  clean_key := upper(trim(p_key));
  if clean_key is null or length(clean_key) < 20 or length(clean_key) > 80 then
    raise exception 'invalid_key';
  end if;

  update public.keys
  set status = 'expired'
  where key_hash = encode(extensions.digest(clean_key, 'sha256'), 'hex')
    and status = 'available'
    and expires_at is not null
    and expires_at <= now();

  update public.keys
  set status = 'redeemed',
      assigned_to = uid,
      redeemed_at = now(),
      expires_at = case duration
        when '48h' then now() + interval '48 hours'
        when '24h' then now() + interval '24 hours'
        when '7d' then now() + interval '7 days'
        when '30d' then now() + interval '30 days'
        else null
      end
  where key_hash = encode(extensions.digest(clean_key, 'sha256'), 'hex')
    and status = 'available'
  returning * into row_key;

  if row_key.id is null then
    raise exception 'key_unavailable';
  end if;

  insert into public.audit_logs(actor_id, action, target_id, metadata)
  values(uid, 'key.redeemed', row_key.id, jsonb_build_object('duration', row_key.duration));

  return jsonb_build_object(
    'id', row_key.id,
    'key', clean_key,
    'duration', row_key.duration,
    'expires_at', row_key.expires_at,
    'redeemed_at', row_key.redeemed_at
  );
end;
$$;

create or replace function public.bind_key_device(p_key_id uuid, p_device_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); target public.keys%rowtype;
begin
 if uid is null or (select role from public.profiles where id = uid) not in ('user', 'owner') then raise exception 'not_authorized' using errcode = '42501'; end if;
 if p_device_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_device'; end if;
 update public.keys set status = 'expired' where id = p_key_id and assigned_to = uid and status = 'redeemed' and expires_at is not null and expires_at <= now();
 select * into target from public.keys where id = p_key_id and assigned_to = uid for update;
 if target.id is null or target.status <> 'redeemed' or (target.expires_at is not null and target.expires_at <= now()) then raise exception 'key_unavailable'; end if;
 if target.device_hash is null then
  update public.keys set device_hash = p_device_hash, device_bound_at = now() where id = p_key_id;
 elsif target.device_hash <> p_device_hash then raise exception 'device_mismatch';
 end if;
 return jsonb_build_object('valid', true, 'bound_at', coalesce(target.device_bound_at, now()));
end
$$;

create or replace function public.reset_my_key_device(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) not in ('user', 'owner') then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set device_hash = null, device_bound_at = null
 where id = p_key_id and assigned_to = uid and status = 'redeemed';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.device_reset', p_key_id, '{"source":"web"}'::jsonb);
end
$$;

-- Owners may also delete their own revoked keys; users only expired ones.
create or replace function public.delete_expired_key(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); caller_role public.app_role;
begin
 select role into caller_role from public.profiles where id = uid;
 if uid is null or caller_role not in ('user', 'owner') then
  raise exception 'not_authorized' using errcode = '42501';
 end if;
 update public.keys set status = 'expired'
 where id = p_key_id and assigned_to = uid and status = 'redeemed'
  and expires_at is not null and expires_at <= now();
 delete from public.keys
 where id = p_key_id and assigned_to = uid
  and (status = 'expired' or (status = 'revoked' and caller_role = 'owner'));
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id) values (uid, 'key.deleted', p_key_id);
end;
$$;

drop function if exists public.admin_reset_key_device(uuid);
drop function if exists public.admin_delete_expired_key(uuid);

create function public.owner_reset_key_device(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'owner' then
  raise exception 'not_authorized' using errcode = '42501';
 end if;
 update public.keys set device_hash = null, device_bound_at = null
 where id = p_key_id and status = 'redeemed';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata)
 values (uid, 'key.device_reset', p_key_id, '{"source":"web-owner"}'::jsonb);
end
$$;
revoke all on function public.owner_reset_key_device(uuid) from public, anon;
grant execute on function public.owner_reset_key_device(uuid) to authenticated;

create function public.owner_delete_expired_key(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'owner' then
  raise exception 'not_authorized' using errcode = '42501';
 end if;
 update public.keys set status = 'expired'
 where id = p_key_id and status = 'redeemed'
  and expires_at is not null and expires_at <= now();
 delete from public.keys where id = p_key_id and status = 'expired';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata)
 values (uid, 'key.deleted', p_key_id, '{"source":"web-owner"}'::jsonb);
end
$$;
revoke all on function public.owner_delete_expired_key(uuid) from public, anon;
grant execute on function public.owner_delete_expired_key(uuid) to authenticated;

create or replace function public.revoke_key(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set status = 'revoked', revoked_at = now() where id = p_id and (generated_by = uid or (select role from public.profiles where id = uid) = 'owner') and status <> 'revoked';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id) values(uid, 'key.revoked', p_id);
end
$$;

create or replace function public.reset_key_device(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set device_hash = null, device_bound_at = null
 where id = p_key_id and ((select role from public.profiles where id = uid) = 'owner' or (generated_by = uid and assigned_to is not null));
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.device_reset', p_key_id, '{}'::jsonb);
end
$$;

create or replace function public.get_discord_admin_allowlist() returns table(discord_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.profiles where id = auth.uid() and role = 'owner') then raise exception 'not_authorized' using errcode = '42501'; end if;
 return query select a.discord_id from public.admin_allowlist a order by a.created_at;
end
$$;

create or replace function public.dashboard_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); role_value public.app_role;
begin
 select role into role_value from public.profiles where id = uid;
 if role_value is null then raise exception 'not_authorized' using errcode = '42501'; end if;
 if role_value = 'user' then
  return (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'redeemed' and (expires_at is null or expires_at > now())), 'expired', count(*) filter (where status = 'expired' or (status <> 'revoked' and expires_at <= now())), 'revoked', count(*) filter (where status = 'revoked')) from public.keys where assigned_to = uid);
 end if;
 return (select jsonb_build_object('total', count(*), 'available', count(*) filter (where status = 'available' and (expires_at is null or expires_at > now())), 'redeemed', count(*) filter (where status = 'redeemed'), 'expired', count(*) filter (where status = 'expired' or (status <> 'revoked' and expires_at <= now())), 'revoked', count(*) filter (where status = 'revoked')) from public.keys where generated_by = uid or role_value = 'owner');
end
$$;

create or replace function public.sync_discord_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare discord_name text;
begin
 if new.provider = 'discord' then
  discord_name := coalesce(new.identity_data->>'preferred_username', new.identity_data->>'username');
  update public.profiles set discord_id = new.provider_id, discord_username = discord_name, updated_at = now()
  where id = new.user_id;
  if exists(select 1 from public.admin_allowlist a where a.discord_id = new.provider_id) then
   update public.profiles set role = 'owner', updated_at = now() where id = new.user_id;
  end if;
 end if;
 return new;
end
$$;

create or replace function public.ensure_my_profile() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); auth_user auth.users%rowtype; discord_identity text; discord_name text;
begin
 if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
 select * into auth_user from auth.users where id = uid;
 if auth_user.id is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
 insert into public.profiles(id, username) values(uid, left('account-' || left(uid::text, 8), 32)) on conflict (id) do nothing;
 select i.provider_id, coalesce(i.identity_data->>'preferred_username', i.identity_data->>'username') into discord_identity, discord_name
 from auth.identities i where i.user_id = uid and i.provider = 'discord' limit 1;
 if discord_identity is not null then
  update public.profiles p set discord_id = discord_identity, discord_username = discord_name,
   role = case when exists(select 1 from public.admin_allowlist a where a.discord_id = discord_identity) then 'owner'::public.app_role else p.role end
  where p.id = uid;
 end if;
end
$$;

revoke all on function public.sync_discord_identity() from public, anon, authenticated;

notify pgrst, 'reload schema';
