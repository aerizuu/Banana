import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Settings as SettingsIcon, Sun, TicketCheck, X, RotateCcw } from 'lucide-react'
import { supabase } from './lib/supabase'

type Theme = 'dark' | 'light' | 'system'
type Profile = { username: string; discord_username: string | null; role: 'user' | 'developer' | 'admin'; discord_id: string | null; preferred_theme: Theme }
type KeyRow = { id: string; duration: string; status: string; created_at: string; redeemed_at: string | null; expires_at: string | null; key_prefix: string; assigned_to: string | null; device_bound_at: string | null }

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('banana-theme') as Theme) || 'system')
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme }
    apply(); localStorage.setItem('banana-theme', theme)
    if (supabase) void supabase.auth.getUser().then(({ data }) => { if (data.user) void supabase!.from('profiles').update({ preferred_theme: theme }).eq('id', data.user.id) })
    if (theme !== 'system') return
    const media = matchMedia('(prefers-color-scheme: light)'); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply)
  }, [theme])
  return [theme, setTheme] as const
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const [session, setSession] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    if (!supabase) { setSession(false); return }
    let alive = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => {
      if (!alive) return
      setSession(!!current)
      if (current) void loadProfile(current.user.id)
      else setProfile(null)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return
      if (error) { setSession(false); return }
      setSession(!!data.session)
      if (data.session) void loadProfile(data.session.user.id)
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])
  async function loadProfile(id: string) {
    const { data } = await supabase!.from('profiles').select('username,discord_username,role,discord_id,preferred_theme').eq('id', id).maybeSingle()
    if (data) { const value = data as Profile; setProfile(value); setTheme(value.preferred_theme) }
    else {
      await supabase!.rpc('ensure_my_profile')
      const { data: created } = await supabase!.from('profiles').select('username,discord_username,role,discord_id,preferred_theme').eq('id', id).maybeSingle()
      if (created) { const value = created as Profile; setProfile(value); setTheme(value.preferred_theme) }
    }
  }
  if (session === null) return <main className="loading">Restoring your session…</main>
  if (!supabase) return <main className="setup"><Brand /><h1>Connect your Supabase project</h1><p>Add your project URL and publishable key to <code>.env</code>. Apply the included migration before signing in.</p><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code></main>
  return <Routes>
    <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
    <Route path="*" element={session ? <div className="shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><Brand /><button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X /></button><div className="nav-label">WORKSPACE</div><nav>
        <NavLink to="/" icon={<LayoutDashboard />} label="Dashboard" close={() => setMobileOpen(false)} />{profile?.role !== 'admin' && <NavLink to="/keys" icon={<KeyRound />} label="Key Manage" close={() => setMobileOpen(false)} />}{profile?.role === 'user' ? <RedeemNav profile={profile} close={() => setMobileOpen(false)} /> : profile?.role === 'developer' ? <NavLink to="/get-key" icon={<KeyRound />} label="Get Key" close={() => setMobileOpen(false)} /> : profile?.role === 'admin' ? <><NavLink to="/get-key" icon={<KeyRound />} label="Get Key" close={() => setMobileOpen(false)} /><NavLink to="/redeem" icon={<TicketCheck />} label="Redeem Key" close={() => setMobileOpen(false)} /></> : null}
      </nav><div className="sidebar-bottom">{profile?.role === 'admin' && <NavLink to="/admin" icon={<SettingsIcon />} label="Admin Dashboard" close={() => setMobileOpen(false)} />}<NavLink to="/settings" icon={<SettingsIcon />} label="Settings" close={() => setMobileOpen(false)} /><button className="nav-item" onClick={() => void supabase!.auth.signOut()}><LogOut />Sign out</button></div></aside>
      {mobileOpen && <button aria-label="Close menu overlay" className="scrim" onClick={() => setMobileOpen(false)} />}
      <div className="main-column"><header className="topbar"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button><span className="crumb">BANANA HUB <span>/</span> WORKSPACE</span><button className="theme-toggle" aria-label={`Theme: ${theme}. Click to change`} onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>{theme === 'light' ? <Sun /> : <Moon />}<span>{theme}</span></button></header><main className="content"><Routes><Route path="/" element={<Dashboard profile={profile} />} /><Route path="/keys" element={<Keys profile={profile} />} /><Route path="/redeem" element={profile?.role === 'user' || profile?.role === 'admin' ? <Redeem profile={profile} /> : <Navigate to="/" replace />} /><Route path="/get-key" element={profile && profile.role !== 'user' ? <GetKey /> : <Navigate to="/" replace />} /><Route path="/settings" element={<SettingsPage profile={profile} theme={theme} setTheme={setTheme} />} /><Route path="/admin" element={profile?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main></div>
    </div> : <Navigate to="/login" replace />} />
  </Routes>
}

function Brand() { return <Link className="brand" to="/"><img className="brand-logo" src="/bananalogo.png" alt="" /><span>banana hub</span></Link> }
function NavLink({ to, icon, label, close }: { to: string; icon: ReactNode; label: string; close: () => void }) { return <Link className="nav-item" to={to} onClick={close}>{icon}<span>{label}</span></Link> }
function RedeemNav({ profile, close }: { profile: Profile; close: () => void }) {
  const { data, isLoading } = useKeys(profile)
  if (isLoading || data?.some(key => key.assigned_to !== null)) return null
  return <NavLink to="/redeem" icon={<TicketCheck />} label="Redeem Key" close={close} />
}
function Login() {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); setBusy(true); try { const { data, error: authError } = await supabase!.functions.invoke('username-login', { body: { username, password } }); if (authError || !data?.session) setError('Sign-in failed. Check your details or contact your administrator.'); else { const { error: sessionError } = await supabase!.auth.setSession(data.session); if (sessionError) setError('Could not establish your session. Please try again.') } } catch { setError('Sign-in service unavailable. Please try again.') } finally { setBusy(false) } }
  async function discord() { setError(''); setBusy(true); const { error } = await supabase!.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: `${location.origin}/` } }); if (error) { setError('Discord sign-in failed. Check Discord provider settings in Supabase.'); setBusy(false) } }
  return <main className="login-page"><section className="login-panel"><Brand /><p className="overline">ACCESS PORTAL</p><h1>Sign in to your workspace.</h1><p className="muted">Manage keys issued through Banana Hub.</p><form onSubmit={submit}><label htmlFor="username">Username</label><input id="username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /><label htmlFor="password">Password</label><div className="password-field"><input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button type="button" className="text-button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form><div className="divider"><span>OR</span></div><button className="secondary-button full" disabled={busy} onClick={() => void discord()}>{busy ? 'Connecting…' : 'Continue with Discord'}</button><p className="login-note">Accounts are provisioned by your administrator.</p></section></main>
}
function PageTitle({ kicker, title, detail }: { kicker: string; title: string; detail: string }) { return <div className="page-title"><p className="overline">{kicker}</p><h1>{title}</h1><p className="muted">{detail}</p></div> }
function useKeys(profile: Profile | null, scope: 'account' | 'admin' = 'account') {
  return useQuery({ queryKey: ['keys', profile?.role, scope], enabled: !!profile && !!supabase, queryFn: async (): Promise<KeyRow[]> => {
  const column = profile?.role === 'user' ? 'assigned_to' : 'generated_by'
    const { data: user } = await supabase!.auth.getUser(); if (!user.user) throw new Error('Session expired')
    let query = supabase!.from('keys').select('id,duration,status,created_at,redeemed_at,expires_at,key_prefix,assigned_to,device_bound_at').order('created_at', { ascending: false }).limit(50)
    if (profile?.role === 'admin' && scope === 'admin') query = query
    else if (profile?.role === 'admin') query = query.eq('assigned_to', user.user.id)
    else query = query.eq(column, user.user.id)
    const { data, error } = await query
    if (error) throw error
    return data as KeyRow[]
  } })
}
function KeyRows({ profile, scope = 'account' }: { profile: Profile | null; scope?: 'account' | 'admin' }) {
  const { data, isLoading, error } = useKeys(profile, scope)
  const queryClient = useQueryClient()
  if (isLoading) return <p className="state">Loading key activity…</p>
  if (error) return <p className="state error">Could not load keys. Refresh the page to try again.</p>
  const visible = data?.filter(row => !(row.assigned_to && row.status === 'expired' || row.assigned_to && row.expires_at && new Date(row.expires_at) <= new Date()))
  if (!visible?.length) return <div className="empty"><KeyRound /><p>No active keys.</p><span>Expired keys disappear from this list.</span></div>
  return <ul className="key-list">{visible.map(row => <li key={row.id}><span className="key-id">{row.key_prefix}••••</span><span>{row.duration}</span><span className={`status ${row.status}`}>{row.status}</span><time>{new Date(row.created_at).toLocaleDateString()}</time>{profile?.role === 'user' && row.status === 'redeemed' && <><span className="muted">{row.device_bound_at ? 'Device linked' : 'Not linked yet'}</span><SavedRedeemedKey keyId={row.id} /><span className="muted">Expires: {row.expires_at ? new Date(row.expires_at).toLocaleString() : 'Never'}</span><button className="secondary-button" onClick={() => void resetDevice(row.id, () => queryClient.invalidateQueries({ queryKey: ['keys', profile.role, scope] }))}><RotateCcw /> Reset device</button></>}{profile?.role === 'admin' && scope === 'admin' && row.status === 'redeemed' && <button className="secondary-button" onClick={() => void resetAdminDevice(row.id, () => queryClient.invalidateQueries({ queryKey: ['keys', profile.role, scope] }))}><RotateCcw /> Reset device</button>}</li>)}</ul>
}
function SavedRedeemedKey({ keyId }: { keyId: string }) {
  const [key] = useState(() => localStorage.getItem(`banana-redeemed-key:${keyId}`) || '')
  const [show, setShow] = useState(false)
  if (!key) return <span className="muted">Key shown once when redeemed; not saved on this browser.</span>
  return <div className="saved-key"><code>{show ? key : `${key.slice(0, 5)}${'•'.repeat(Math.max(8, key.length - 5))}`}</code><button type="button" className="secondary-button key-toggle" aria-label={show ? 'Hide full key' : 'Show full key'} aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{show ? 'Hide' : 'Show'}</button><button type="button" className="secondary-button key-copy" onClick={() => void navigator.clipboard.writeText(key).then(() => window.alert('Key copied.'))}>Copy</button></div>
}
async function resetDevice(id: string, refresh: () => unknown) { if (!window.confirm('Reset device binding? The next Lua client using this key will bind a new device.')) return; const { error } = await supabase!.rpc('reset_my_key_device', { p_key_id: id }); if (error) window.alert('Could not reset device link. Try again.'); else void refresh() }
async function resetAdminDevice(id: string, refresh: () => unknown) { if (!window.confirm('Reset this key device binding? The next Lua client using it will bind a new device.')) return; const { error } = await supabase!.rpc('reset_key_device', { p_key_id: id }); if (error) window.alert('Could not reset device link. Check admin permissions.'); else void refresh() }
function Dashboard({ profile }: { profile: Profile | null }) { const name = profile?.discord_username || profile?.username; return <><PageTitle kicker="OVERVIEW" title={`Welcome${name ? `, ${name}` : ''}`} detail="A current view of your key activity." /><section className="data-section"><div className="section-heading"><h2>Key activity</h2></div><KeyRows profile={profile} /></section></> }
function Keys({ profile }: { profile: Profile | null }) { return <><PageTitle kicker="KEYS" title="Key Manage" detail="Review keys assigned to your account or generated by you." /><section className="data-section"><KeyRows profile={profile} /></section></> }
function Redeem({ profile }: { profile: Profile }) {
  const [value, setValue] = useState(''); const [message, setMessage] = useState(''); const [redeemed, setRedeemed] = useState(''); const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const { data: keys, isLoading } = useKeys(profile)
  const existing = profile.role === 'user' && keys?.some(key => key.assigned_to !== null)
  async function redeem(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(''); setRedeemed('')
    const clean = value.trim().toUpperCase()
    try {
      const { data, error } = await supabase!.rpc('redeem_key', { p_key: clean })
      if (error) setMessage(error.message.includes('404') || error.code === 'PGRST202' ? 'Redeem service is not installed yet. Ask the administrator to apply the latest database migration.' : error.message.includes('key_unavailable') ? 'This key is invalid, expired, revoked, or already redeemed.' : error.message.includes('not_authorized') ? 'This action requires an authorized account.' : 'Could not redeem key. Please retry.')
      else {
        const result = data as { id?: string; duration?: string; expires_at?: string | null } | null
        if (result?.id) localStorage.setItem(`banana-redeemed-key:${result.id}`, clean)
        setRedeemed(clean); setMessage(`Key redeemed. Duration: ${result?.duration ?? 'unknown'}.`); setValue('')
        await queryClient.invalidateQueries({ queryKey: ['keys', profile.role] })
      }
    } catch { setMessage('Could not reach the redeem service. Check your connection.') } finally { setBusy(false) }
  }
  if (isLoading) return <><PageTitle kicker="REDEMPTION" title="Redeem Key" detail="Checking your account." /><p className="state">Loading redemption status?</p></>
  if (existing) return <><PageTitle kicker="REDEMPTION" title="Key already redeemed" detail="Each account can redeem one key." /><KeyRows profile={profile} /></>
  return <><PageTitle kicker="REDEMPTION" title="Redeem Key" detail="Enter a key provided by a developer." /><form className="action-form" onSubmit={redeem}><label htmlFor="redeem-key">Access key</label><input id="redeem-key" required autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste your key" />{message && <p role="status" className="state">{message}</p>}{redeemed && <><label htmlFor="redeemed-key">Your key</label><input id="redeemed-key" readOnly value={redeemed} /><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(redeemed).then(() => setMessage('Key copied.'))}>Copy key</button></> }<button className="primary-button" disabled={busy}>{busy ? 'Redeeming?' : 'Redeem key'}</button></form></>
}
function GetKey() { const [duration, setDuration] = useState<'24h' | '7d' | '30d' | 'lifetime'>('24h'); const [result, setResult] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(true); async function generate() { setBusy(true); setResult(''); setMessage(''); setShow(true); try { const { data, error } = await supabase!.rpc('generate_key', { p_duration: duration }); if (error || !data || typeof data !== 'object' || !('key' in data)) setMessage('Key generation failed. Please try again.'); else setResult(String(data.key)) } catch { setMessage('Key generation failed. Check your connection and try again.') } finally { setBusy(false) } } return <><PageTitle kicker="KEY ISSUANCE" title="Get Key" detail="Generate an access key. Validity begins immediately." /><section className="action-form"><label htmlFor="duration">Key duration</label><select id="duration" value={duration} onChange={e => setDuration(e.target.value as typeof duration)}><option value="24h">24 Hours</option><option value="7d">7 Days</option><option value="30d">30 Days</option><option value="lifetime">Lifetime</option></select><button className="primary-button" onClick={() => void generate()} disabled={busy}>{busy ? 'Generating…' : 'Generate key'}</button>{message && <p role="alert" className="form-error">{message}</p>}{result && <div className="generated"><label htmlFor="generated-key">New key, shown once</label><div className="saved-key"><input id="generated-key" type={show ? 'text' : 'password'} readOnly value={result} /><button type="button" className="secondary-button key-toggle" aria-label={show ? 'Hide full key' : 'Show full key'} aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{show ? 'Hide' : 'Show'}</button><button type="button" className="secondary-button key-copy" onClick={() => void navigator.clipboard.writeText(result)}>Copy key</button></div><p>Save this key now. It cannot be retrieved later.</p></div>}</section></> }
function SettingsPage({ profile, theme, setTheme }: { profile: Profile | null; theme: Theme; setTheme: (value: Theme) => void }) { return <><PageTitle kicker="PREFERENCES" title="Settings" detail="Account details and appearance." /><section className="settings-block"><h2>Appearance</h2><p className="muted">Choose how Banana Hub looks.</p><div className="theme-options">{(['dark', 'light', 'system'] as const).map(item => <button key={item} className={theme === item ? 'selected' : ''} onClick={() => setTheme(item)}>{item === 'dark' ? <Moon /> : <Sun />}{item[0].toUpperCase() + item.slice(1)}</button>)}</div></section><section className="settings-block"><h2>Account</h2><dl><div><dt>Username</dt><dd>{profile?.username ?? 'Unavailable'}</dd></div><div><dt>Role</dt><dd>{profile?.role ?? 'Unavailable'}</dd></div><div><dt>Discord ID</dt><dd>{profile?.discord_id ?? 'Not linked'}</dd></div></dl><button className="secondary-button" onClick={() => void supabase!.auth.signOut()}>Sign out</button></section></> }

function AdminSettings() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-allowlist'], queryFn: async (): Promise<string[]> => { const { data, error } = await supabase!.rpc('get_discord_admin_allowlist'); if (error) throw error; return (data as { discord_id: string }[]).map(row => row.discord_id) } })
  return <><PageTitle kicker="ACCESS CONTROL" title="Admin configuration" detail="Admin IDs are configured privately in Supabase, never in browser environment variables." /><section className="settings-block"><h2>Discord admin IDs</h2>{isLoading ? <p className="state">Loading admin list…</p> : error ? <p className="state error">Could not load admin list.</p> : <ul className="admin-list">{data?.map(id => <li key={id}>{id}</li>)}</ul>}<p className="muted">Manage IDs using Supabase SQL Editor. Changes apply at next Discord sign-in.</p></section></>
}
function AdminDashboard() { return <><PageTitle kicker="ADMINISTRATION" title="Admin Dashboard" detail="Review all issued keys and reset device bindings." /><section className="data-section"><div className="section-heading"><h2>All keys</h2></div><KeyRows profile={{ username: '', discord_username: null, role: 'admin', discord_id: null, preferred_theme: 'system' }} scope="admin" /></section><AdminSettings /></> }
