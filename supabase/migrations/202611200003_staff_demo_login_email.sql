-- Align the demo staff email with the client's username fallback
-- (`<username>@bananahub.local`) so `staff / staff123` signs in without
-- the undeployed username-login edge function.
update auth.users
set email = 'staff@bananahub.local', updated_at = now()
where email = 'staffdemo@bananahub.com';
