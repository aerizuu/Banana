create or replace function public.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare base_name text; candidate text;
begin
 base_name := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'preferred_username', new.raw_user_meta_data->>'username', 'account'), '[^a-zA-Z0-9_.-]', '', 'g'));
 base_name := left(coalesce(nullif(base_name, ''), 'account'), 23);
 candidate := base_name || '-' || left(new.id::text, 8);
 insert into public.profiles(id, username) values(new.id, candidate) on conflict (id) do nothing;
 return new;
end
$$;
revoke all on function public.create_profile() from public, anon, authenticated;
update public.profiles p set discord_username = coalesce(i.identity_data->>'global_name', i.identity_data->>'preferred_username', i.identity_data->>'username'),
 username = left(coalesce(i.identity_data->>'global_name', i.identity_data->>'preferred_username', i.identity_data->>'username'), 23) || '-' || left(p.id::text, 8)
from auth.identities i where i.user_id = p.id and i.provider = 'discord' and coalesce(i.identity_data->>'global_name', i.identity_data->>'preferred_username', i.identity_data->>'username') is not null;
