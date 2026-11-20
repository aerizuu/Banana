-- Role model becomes Owner / Admin / User. 'developer' stays in the enum
-- (Postgres cannot drop enum values) but is no longer assigned.
alter type public.app_role add value if not exists 'owner';
