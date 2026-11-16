Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const state = crypto.randomUUID()
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/discord-callback`
  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({ client_id: Deno.env.get('DISCORD_CLIENT_ID')!, redirect_uri: redirectUri, response_type: 'code', scope: 'identify email', state }).toString()
  const headers = new Headers({ Location: url.toString() })
  headers.append('Set-Cookie', `banana_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/functions/v1/discord-callback; Max-Age=600; Domain=${new URL(Deno.env.get('SUPABASE_URL')!).hostname}`)
  return new Response(null, { status: 302, headers })
})
