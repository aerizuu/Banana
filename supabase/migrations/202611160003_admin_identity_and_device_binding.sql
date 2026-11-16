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
 insert into public.profiles(id, username, discord_id, discord_username)
 values (new.id, left(requested_name, 32), discord_identity, new.raw_user_meta_data->>'full_name');
 return new;
end
$$;

create function public.sync_discord_admin_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.discord_id is not null and exists (select 1 from public.admin_allowlist where discord_id = new.discord_id) then new.role := 'admin'; end if;
 return new;
end
$$;
create trigger profile_discord_admin_role before insert or update of discord_id on public.profiles
for each row execute function public.sync_discord_admin_role();

create function public.sync_discord_identity() returns trigger language plpgsql security definer set search_path = '' as $$
declare discord_name text;
begin
 if new.provider = 'discord' then
  discord_name := coalesce(new.identity_data->>'preferred_username', new.identity_data->>'username');
  update public.profiles set discord_id = new.provider_id, discord_username = discord_name, updated_at = now() where id = new.user_id;
 end if;
 return new;
end
$$;
create trigger discord_identity_linked after insert on auth.identities
for each row execute function public.sync_discord_identity();

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('developer', 'admin'))
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

drop policy if exists "profile theme update self" on public.profiles;
create policy "profile update self without privilege changes" on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (
 id = (select auth.uid())
 and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
 and preferred_theme is distinct from (select p.preferred_theme from public.profiles p where p.id = (select auth.uid()))
 and username = (select p.username from public.profiles p where p.id = (select auth.uid()))
 and discord_id is not distinct from (select p.discord_id from public.profiles p where p.id = (select auth.uid()))
 and discord_username is not distinct from (select p.discord_username from public.profiles p where p.id = (select auth.uid()))
 and discord_avatar is not distinct from (select p.discord_avatar from public.profiles p where p.id = (select auth.uid()))
);
drop policy if exists "developers read generated keys" on public.keys;
create policy "staff read managed keys" on public.keys for select to authenticated
using (public.is_staff() and (generated_by = (select auth.uid()) or (select role from public.profiles where id = (select auth.uid())) = 'admin'));

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

create function public.admin_set_discord_id(p_user_id uuid, p_discord_id text, p_discord_username text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'admin' then raise exception 'not_authorized' using errcode = '42501'; end if;
 if p_discord_id !~ '^[0-9]{15,22}$' then raise exception 'invalid_discord_id'; end if;
 update public.profiles set discord_id = p_discord_id, discord_username = p_discord_username, updated_at = now() where id = p_user_id;
 if not found then raise exception 'profile_not_found'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'account.discord_linked', p_user_id, jsonb_build_object('discord_id', p_discord_id));
end
$$;
revoke all on function public.admin_set_discord_id(uuid, text, text) from public, anon;
grant execute on function public.admin_set_discord_id(uuid, text, text) to authenticated;

create function public.set_discord_admin_allowlist(p_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'admin' then raise exception 'not_authorized' using errcode = '42501'; end if;
 if exists(select 1 from unnest(p_ids) x where x !~ '^[0-9]{15,22}$') then raise exception 'invalid_discord_id'; end if;
 delete from public.admin_allowlist where discord_id <> all(p_ids);
 insert into public.admin_allowlist(discord_id) select distinct unnest(p_ids) on conflict do nothing;
 update public.profiles set role = 'user' where role = 'admin' and (discord_id is null or not exists(select 1 from public.admin_allowlist a where a.discord_id = profiles.discord_id));
 update public.profiles set role = 'admin' where discord_id in (select discord_id from public.admin_allowlist);
end
$$;
revoke all on function public.set_discord_admin_allowlist(text[]) from public, anon;
grant execute on function public.set_discord_admin_allowlist(text[]) to authenticated;

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
