-- Remove the demo accounts (user, staff, user2) and every key they issued
-- or redeemed, plus their audit rows. Real accounts and keys are untouched.
delete from public.keys
where generated_by in (select id from auth.users where email in ('userdemo@bananahub.com', 'staff@bananahub.local', 'user2@bananahub.local'))
   or assigned_to in (select id from auth.users where email in ('userdemo@bananahub.com', 'staff@bananahub.local', 'user2@bananahub.local'));

delete from public.audit_logs
where actor_id in (select id from auth.users where email in ('userdemo@bananahub.com', 'staff@bananahub.local', 'user2@bananahub.local'));

delete from auth.users
where email in ('userdemo@bananahub.com', 'staff@bananahub.local', 'user2@bananahub.local');
