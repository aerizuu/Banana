create extension if not exists pgcrypto;
create type public.app_role as enum ('user', 'developer');
create type public.key_duration as enum ('24h', '7d', '30d', 'lifetime');
create type public.key_status as enum ('available', 'redeemed', 'revoked');
create type public.theme_preference as enum ('dark', 'light', 'system');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (length(username) between 3 and 32),
 role public.app_role not null default 'user',
 discord_id text unique, discord_username text, discord_avatar text,
 preferred_theme public.theme_preference not null default 'system',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.keys (
 id uuid primary key default gen_random_uuid(), key_hash text not null unique, key_prefix text not null,
 generated_by uuid not null references public.profiles(id), assigned_to uuid references public.profiles(id),
 duration public.key_duration not null, status public.key_status not null default 'available',
 created_at timestamptz not null default now(), redeemed_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
 constraint key_expiry_matches_duration check ((duration = 'lifetime' and expires_at is null) or (duration <> 'lifetime' and expires_at is not null)),
 constraint key_assignment_matches_status check ((status = 'available' and assigned_to is null and redeemed_at is null) or (status = 'redeemed' and assigned_to is not null and redeemed_at is not null) or status = 'revoked')
);
create index keys_generated_by_created_idx on public.keys(generated_by, created_at desc);
create index keys_assigned_to_created_idx on public.keys(assigned_to, created_at desc);
create index keys_status_expiry_idx on public.keys(status, expires_at);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id),
 action text not null check (action in ('key.generated', 'key.redeemed', 'key.revoked', 'account.theme_changed', 'account.discord_linked')),
 target_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_logs_actor_created_idx on public.audit_logs(actor_id, created_at desc);
create function public.current_role() returns public.app_role language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id = (select auth.uid())
$$;
revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated;
create function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_name text;
begin
 requested_name := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
 insert into public.profiles(id, username) values (new.id, left(requested_name, 32));
 return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
alter table public.profiles enable row level security;
alter table public.keys enable row level security;
alter table public.audit_logs enable row level security;
create policy "profile read self" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profile theme update self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = public.current_role() and username = (select username from public.profiles p where p.id = (select auth.uid())) and discord_id is not distinct from (select discord_id from public.profiles p where p.id = (select auth.uid())));
create policy "users read assigned keys" on public.keys for select to authenticated using (assigned_to = (select auth.uid()));
create policy "developers read generated keys" on public.keys for select to authenticated using (generated_by = (select auth.uid()) and public.current_role() = 'developer');
create policy "read own audit" on public.audit_logs for select to authenticated using (actor_id = (select auth.uid()));
create function public.generate_key(p_duration public.key_duration) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); raw_key text; key_id uuid; expiry timestamptz;
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'developer' then raise exception 'not_authorized' using errcode = '42501'; end if;
 if p_duration not in ('24h', '7d', '30d', 'lifetime') then raise exception 'invalid_duration'; end if;
 raw_key := 'BH-' || upper(encode(gen_random_bytes(24), 'hex'));
 expiry := case p_duration when '24h' then now() + interval '24 hours' when '7d' then now() + interval '7 days' when '30d' then now() + interval '30 days' else null end;
 insert into public.keys(key_hash, key_prefix, generated_by, duration, expires_at)
 values (encode(digest(raw_key, 'sha256'), 'hex'), left(raw_key, 11), uid, p_duration, expiry) returning id into key_id;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.generated', key_id, jsonb_build_object('duration', p_duration));
 return jsonb_build_object('id', key_id, 'key', raw_key, 'duration', p_duration, 'expires_at', expiry);
end
$$;
create function public.redeem_key(p_key text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); row_key public.keys%rowtype;
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'user' then raise exception 'not_authorized' using errcode = '42501'; end if;
 if p_key is null or length(p_key) < 20 or length(p_key) > 80 then raise exception 'invalid_key'; end if;
 update public.keys set status = 'redeemed', assigned_to = uid, redeemed_at = now()
 where key_hash = encode(digest(p_key, 'sha256'), 'hex') and status = 'available' and (expires_at is null or expires_at > now()) returning * into row_key;
 if row_key.id is null then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id, metadata) values(uid, 'key.redeemed', row_key.id, jsonb_build_object('duration', row_key.duration));
 return jsonb_build_object('id', row_key.id, 'duration', row_key.duration, 'expires_at', row_key.expires_at, 'redeemed_at', row_key.redeemed_at);
end
$$;
create function public.revoke_key(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or (select role from public.profiles where id = uid) <> 'developer' then raise exception 'not_authorized' using errcode = '42501'; end if;
 update public.keys set status = 'revoked', revoked_at = now() where id = p_id and generated_by = uid and status <> 'revoked';
 if not found then raise exception 'key_unavailable'; end if;
 insert into public.audit_logs(actor_id, action, target_id) values(uid, 'key.revoked', p_id);
end
$$;
revoke all on function public.generate_key(public.key_duration), public.redeem_key(text), public.revoke_key(uuid) from public, anon;
grant execute on function public.generate_key(public.key_duration), public.redeem_key(text), public.revoke_key(uuid) to authenticated;
create function public.dashboard_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); role_value public.app_role;
begin
 select role into role_value from public.profiles where id = uid;
 if role_value is null then raise exception 'not_authorized' using errcode = '42501'; end if;
 if role_value = 'user' then
  return (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'redeemed' and (expires_at is null or expires_at > now())), 'expired', count(*) filter (where status <> 'revoked' and expires_at <= now()), 'revoked', count(*) filter (where status = 'revoked')) from public.keys where assigned_to = uid);
 end if;
 return (select jsonb_build_object('total', count(*), 'available', count(*) filter (where status = 'available' and (expires_at is null or expires_at > now())), 'redeemed', count(*) filter (where status = 'redeemed'), 'expired', count(*) filter (where status <> 'revoked' and expires_at <= now()), 'revoked', count(*) filter (where status = 'revoked')) from public.keys where generated_by = uid);
end
$$;
revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;
