create or replace function public.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare base_name text; candidate text;
begin
 base_name := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'preferred_username', new.raw_user_meta_data->>'username', split_part(coalesce(new.email, 'account'), '@', 1)), '[^a-zA-Z0-9_.-]', '', 'g'));
 base_name := left(coalesce(nullif(base_name, ''), 'account'), 23);
 candidate := base_name || '-' || left(new.id::text, 8);
 insert into public.profiles(id, username) values(new.id, candidate) on conflict (id) do nothing;
 return new;
end
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
revoke all on function public.create_profile() from public, anon, authenticated;

create function public.ensure_my_profile() returns void
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
   role = case when exists(select 1 from public.admin_allowlist a where a.discord_id = discord_identity) then 'admin'::public.app_role else p.role end
  where p.id = uid;
 end if;
end
$$;
revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;
