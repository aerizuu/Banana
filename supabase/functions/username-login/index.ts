import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: cors })
  try {
    const body = await req.json()
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || password.length < 1 || password.length > 256) return new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 400, headers: cors })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: profile } = await admin.from('profiles').select('id').ilike('username', username).maybeSingle()
    if (!profile) return new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401, headers: cors })
    const { data: userData, error: getUserError } = await admin.auth.admin.getUserById(profile.id)
    if (getUserError || !userData.user?.email) return new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401, headers: cors })
    const { data, error } = await admin.auth.signInWithPassword({ email: userData.user.email, password })
    if (error || !data.session) return new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401, headers: cors })
    return new Response(JSON.stringify({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } }), { status: 200, headers: cors })
  } catch { return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400, headers: cors }) }
})
