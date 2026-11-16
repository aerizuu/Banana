alter table public.keys add column if not exists device_hash text;
alter table public.keys add column if not exists device_bound_at timestamptz;
alter table public.keys add constraint key_device_hash_shape check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$');
create index if not exists keys_device_hash_idx on public.keys(device_hash) where device_hash is not null;

create table public.admin_allowlist (
 discord_id text primary key check (discord_id ~ '^[0-9]{15,22}$'),
 created_at timestamptz not null default now()
);
alter table public.admin_allowlist enable row level security;
revoke all on public.admin_allowlist from anon, authenticated;

create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_name text; discord_identity text;
begin
 requested_name := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
 discord_identity := coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub');
 insert into public.profiles(id, username)
 values (new.id, left(requested_name, 32));
 return new;
end
$$;

create function public.sync_discord_identity() returns trigger language plpgsql security definer set search_path = '' as $$
declare discord_name text;
begin
 if new.provider = 'discord' then
  discord_name := coalesce(new.identity_data->>'preferred_username', new.identity_data->>'username');
  update public.profiles set discord_id = new.provider_id, discord_username = discord_name, updated_at = now() where id = new.user_id;
  if exists(select 1 from public.admin_allowlist a where a.discord_id = new.provider_id) then
   update public.profiles set role = 'admin' where id = new.user_id;
  end if;
 end if;
 return new;
end
$$;
revoke all on function public.sync_discord_identity() from public, anon, authenticated;
create trigger discord_identity_linked after insert on auth.identities
for each row execute function public.sync_discord_identity();
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
insert into public.profiles(id, username, discord_id, discord_username)
select u.id, left(coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)), 32), i.provider_id,
       coalesce(i.identity_data->>'preferred_username', i.identity_data->>'username')
from auth.users u join auth.identities i on i.user_id = u.id and i.provider = 'discord'
on conflict (id) do update set discord_id = excluded.discord_id, discord_username = excluded.discord_username,
 role = case when exists(select 1 from public.admin_allowlist a where a.discord_id = excluded.discord_id) then 'admin'::public.app_role else public.profiles.role end;
 update public.profiles p set role = 'admin'
 where p.discord_id in (select a.discord_id from public.admin_allowlist a);

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('developer', 'admin'))
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

drop policy if exists "profile theme update self" on public.profiles;
create policy "profile update appearance self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (
 id = (select auth.uid()) and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
 and username = (select p.username from public.profiles p where p.id = (select auth.uid()))
 and discord_id is not distinct from (select p.discord_id from public.profiles p where p.id = (select auth.uid()))
 and discord_username is not distinct from (select p.discord_username from public.profiles p where p.id = (select auth.uid()))
 and discord_avatar is not distinct from (select p.discord_avatar from public.profiles p where p.id = (select auth.uid()))
);
drop policy if exists "developers read generated keys" on public.keys;
create policy "staff read generated keys" on public.keys for select to authenticated
using (generated_by = (select auth.uid()) and public.is_staff());
create policy "admins read assigned keys" on public.keys for select to authenticated
using (assigned_to = (select auth.uid()) and (select role from public.profiles where id = (select auth.uid())) = 'admin');

create or replace function public.generate_key(p_duration public.key_duration) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); raw_key text; key_id uuid; expiry timestamptz;
begin
 if uid is null or not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
 if p_duration not in ('24h', '7d', '30d', 'lifetime') then raise exception 'invalid_duration'; end if;
 raw_key := 'BH-' || upper(encode(gen_random_bytes(24), 'hex'));
 expiry := case p_duration when '24h' then now() + interval '24 hours' when '7d' then now() + interval '7 days' when '30d' then now() + interval '30 days' else null end;
 insert into public.keys(key_hash, key_prefix, generated_by, duration, expires_at)
 values (encode(digest(raw_key, 'sha256'), 'hex'), left(raw_key, 11), uid, p_duration, expiry) returning id into key_id;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.generated', key_id, jsonb_build_object('duration', p_duration));
 return jsonb_build_object('id', key_id, 'key', raw_key, 'duration', p_duration, 'expires_at', expiry);
end
$$;

create or replace function public.revoke_key(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set status = 'revoked', revoked_at = now() where id = p_id and (generated_by = uid or (select role from public.profiles where id = uid) = 'admin') and status <> 'revoked';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id) values(uid, 'key.revoked', p_id);
end
$$;

create function public.bind_key_device(p_key_id uuid, p_device_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); target public.keys%rowtype;
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'user' then raise exception 'not_authorized' using errcode = '42501'; end if;
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

create function public.reset_key_device(p_key_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or not public.is_staff() then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set device_hash = null, device_bound_at = null
 where id = p_key_id and ((select role from public.profiles where id = uid) = 'admin' or generated_by = uid);
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.device_reset', p_key_id, '{}'::jsonb);
end
$$;

create function public.get_discord_admin_allowlist() returns table(discord_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'not_authorized' using errcode = '42501'; end if;
 return query select a.discord_id from public.admin_allowlist a order by a.created_at;
end
$$;
revoke all on function public.get_discord_admin_allowlist() from public, anon;
grant execute on function public.get_discord_admin_allowlist() to authenticated;

create function public.apply_discord_admin_allowlist() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'DELETE' then
  update public.profiles set role = 'user' where discord_id = old.discord_id and role = 'admin';
 else
  if exists(select 1 from public.admin_allowlist a where a.discord_id = new.discord_id) then
   update public.profiles set role = 'admin' where discord_id = new.discord_id;
  else
   update public.profiles set role = 'user' where discord_id = new.discord_id and role = 'admin';
  end if;
 end if;
 return null;
end
$$;
create trigger admin_allowlist_apply after insert or update or delete on public.admin_allowlist
for each row execute function public.apply_discord_admin_allowlist();

create or replace function public.dashboard_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); role_value public.app_role;
begin
 select role into role_value from public.profiles where id = uid;
 if role_value is null then raise exception 'not_authorized' using errcode = '42501'; end if;
 if role_value = 'user' then
  return (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'redeemed' and (expires_at is null or expires_at > now())), 'expired', count(*) filter (where status = 'expired' or (status <> 'revoked' and expires_at <= now())), 'revoked', count(*) filter (where status = 'revoked')) from public.keys where assigned_to = uid);
 end if;
 return (select jsonb_build_object('total', count(*), 'available', count(*) filter (where status = 'available' and (expires_at is null or expires_at > now())), 'redeemed', count(*) filter (where status = 'redeemed'), 'expired', count(*) filter (where status = 'expired' or (status <> 'revoked' and expires_at <= now())), 'revoked', count(*) filter (where status = 'revoked')) from public.keys where generated_by = uid or role_value = 'admin');
end
$$;

revoke all on function public.bind_key_device(uuid, text), public.reset_key_device(uuid) from public, anon;
grant execute on function public.bind_key_device(uuid, text), public.reset_key_device(uuid) to authenticated;
revoke all on function public.create_profile(), public.sync_discord_identity(), public.apply_discord_admin_allowlist() from public, anon, authenticated;
