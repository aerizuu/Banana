# Banana Hub

Banana Hub is a React/Vite client backed by Supabase Auth, PostgreSQL, RLS, and database operations. The repository contains a first deployable foundation: login, Discord OAuth entry point, role-aware navigation, theme preference, key listing, generation, redemption, and revocation primitives.

## Local setup

1. Install Node.js 20.19+ or 22.12+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`; set `VITE_SUPABASE_URL` and the Supabase publishable/anon key.
4. Apply `supabase/migrations/202611160001_banana_hub.sql` using the Supabase CLI (`supabase db push`) or SQL editor.
5. Configure Discord under Supabase Dashboard → Authentication → Providers. Store Discord Client ID and Client Secret there, never in frontend `.env`.
6. In Discord Developer Portal, register `https://<project-ref>.supabase.co/auth/v1/callback` as the OAuth2 redirect URI. Add the app URL to Supabase Auth redirect allow-list.
7. Deploy the `username-login` Edge Function. Configure Supabase Auth email/password and rate limits.
8. Create accounts through a trusted admin process. To grant developer role, use Supabase SQL/admin tooling, never a client request.
9. Run `npm run dev`; verify production compilation with `npm run build`.

The username login function maps a username to the user's existing Supabase Auth email and verifies the password through Supabase Auth. It does not store passwords. Configure Auth rate limits and add an abuse-control gateway before public launch. The session tokens travel from the function response directly into Supabase Auth's client session storage.

## Deployment

- Push the repository to GitHub and import it in Vercel as a Vite project.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Preview and Production environments. These are public client values, not service credentials.
- Deploy database migrations and Edge Functions to Supabase. Keep `SUPABASE_SERVICE_ROLE_KEY` in Edge Function secrets only.
- Set Supabase Auth Site URL and redirect allow-list for both Vercel preview and production hostnames. Configure Discord OAuth redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
- `vercel.json` rewrites nested SPA URLs to `index.html`; attach a custom domain in Vercel and add it to the Supabase redirect allow-list.

## Security notes / remaining scope

- Database roles default to `user`, with no client role update policy. Promote developers through trusted Supabase administration only.
- Key generation stores SHA-256 hashes; raw keys are returned once. Redemption is a single conditional SQL update, so concurrent redeemers cannot both win. Expiry begins at generation. Lifetime uses `NULL` expiry.
- Admins are determined server-side from the private `public.admin_allowlist` table. Add each verified Discord user ID using the Supabase SQL editor: `insert into public.admin_allowlist(discord_id) values ('DISCORD_NUMERIC_ID');`. Existing profiles require a trusted admin to set `profiles.discord_id` from a verified Discord identity before role synchronization; never accept the ID from browser input.
- Device binding is a stable random browser installation ID hashed client-side then stored as a hash in the key row. It identifies a browser installation, not a physical hardware ID; clearing site data or changing browser can make a new binding. Admin/developer reset is audited. A future protected resource must call `bind_key_device` on use to enforce the binding.
- RLS restricts profile and key reads. Sensitive mutations run as authenticated database functions with role checks; no service key is used by the browser.
- Discord sign-in uses Supabase Auth OAuth. Configure the Discord provider and callback URL in Supabase Dashboard. Supabase Auth owns provider callback and session handling.
- This initial foundation does not yet include full key filters/detail/revoke UI, password change/session management, comprehensive audit browsing, login throttling beyond Supabase Auth configuration, or deployment-tested OAuth. Do not treat it as a completed production security review.
