import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const site = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
Deno.serve(async req => {
  const fail = (reason: string) => Response.redirect(`${site}/login?error=${encodeURIComponent(reason)}`, 303)
  try {
    const incoming = new URL(req.url)
    const code = incoming.searchParams.get('code')
    const state = incoming.searchParams.get('state')
    const savedState = req.headers.get('cookie')?.match(/(?:^|;\s*)banana_oauth_state=([^;]+)/)?.[1]
    if (!code || !state || !savedState || state !== savedState) return fail('oauth_state_invalid')
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/discord-callback`
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: Deno.env.get('DISCORD_CLIENT_ID')!, client_secret: Deno.env.get('DISCORD_CLIENT_SECRET')!, grant_type: 'authorization_code', code, redirect_uri: redirectUri }) })
    if (!tokenResponse.ok) return fail('discord_exchange_failed')
    const oauth = await tokenResponse.json() as { access_token: string }
    const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${oauth.access_token}` } })
    if (!userResponse.ok) return fail('discord_profile_failed')
    const discordUser = await userResponse.json() as { id: string; username: string }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: profile } = await admin.from('profiles').select('id').eq('discord_id', discordUser.id).maybeSingle()
    if (!profile) return fail('account_not_linked')
    const { data: userResult, error: lookupError } = await admin.auth.admin.getUserById(profile.id)
    if (lookupError || !userResult.user?.email) return fail('account_unavailable')
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: userResult.user.email })
    if (linkError || !link.properties?.hashed_token) return fail('session_creation_failed')
    const verify = await admin.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
    if (verify.error || !verify.data.session) return fail('session_creation_failed')

    const session = verify.data.session
    const target = new URL('/', site)
    target.hash = new URLSearchParams({ access_token: session.access_token, refresh_token: session.refresh_token, token_type: 'bearer', expires_in: String(session.expires_in), type: 'recovery' }).toString()
    const response = Response.redirect(target.toString(), 303)
    response.headers.append('Set-Cookie', 'banana_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/functions/v1/discord-callback; Max-Age=0')
    return response
  } catch { return fail('oauth_failed') }
})
