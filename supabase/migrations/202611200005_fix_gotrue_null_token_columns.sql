-- GoTrue scans these columns into non-nullable strings; NULL rows (created
-- by raw SQL inserts) make /auth/v1/token fail with 500 "Database error
-- querying schema". Normalize to empty strings, matching GoTrue's own rows.
update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null;
