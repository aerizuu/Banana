const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: cors })
  const state = crypto.randomUUID()
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/discord-callback`
  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({ client_id: Deno.env.get('DISCORD_CLIENT_ID')!, redirect_uri: redirectUri, response_type: 'code', scope: 'identify email', state }).toString()
  const headers = new Headers(cors)
  headers.append('Set-Cookie', `banana_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/functions/v1/discord-callback; Max-Age=600; Domain=${new URL(Deno.env.get('SUPABASE_URL')!).hostname}`)
  return new Response(JSON.stringify({ url: url.toString() }), { status: 200, headers })
})
