import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LayoutDashboard, LogOut, Menu, Moon, Settings as SettingsIcon, Sun, TicketCheck, X } from 'lucide-react'
import { supabase } from './lib/supabase'

type Theme = 'dark' | 'light' | 'system'
type Profile = { username: string; role: 'user' | 'developer' | 'admin'; discord_id: string | null; preferred_theme: Theme }
type KeyRow = { id: string; duration: string; status: string; created_at: string; expires_at: string | null; key_prefix: string; assigned_to: string | null; device_bound_at: string | null }

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
    const oauthError = new URLSearchParams(location.search).get('error')
    if (oauthError) { window.history.replaceState({}, '', location.pathname); setSession(false); return }
    if (location.hash.includes('access_token=')) {
      const tokens = new URLSearchParams(location.hash.slice(1))
      window.history.replaceState({}, '', location.pathname)
      void supabase.auth.setSession({ access_token: tokens.get('access_token')!, refresh_token: tokens.get('refresh_token')! }).then(({ data, error }) => {
        if (error) { setSession(false); return }
        setSession(true); if (data.user) void loadProfile(data.user.id)
      })
      return
    }
    void supabase.auth.getSession().then(({ data }) => { setSession(!!data.session); if (data.session) void loadProfile(data.session.user.id) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => { setSession(!!current); if (current) void loadProfile(current.user.id); else setProfile(null) })
    return () => subscription.unsubscribe()
  }, [])
  async function loadProfile(id: string) {
    const { data } = await supabase!.from('profiles').select('username,role,discord_id,preferred_theme').eq('id', id).single()
    if (data) { const value = data as Profile; setProfile(value); setTheme(value.preferred_theme) }
  }
  if (session === null) return <main className="loading">Restoring your session…</main>
  if (!supabase) return <main className="setup"><Brand /><h1>Connect your Supabase project</h1><p>Add your project URL and publishable key to <code>.env</code>. Apply the included migration before signing in.</p><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code></main>
  return <Routes>
    <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
    <Route path="*" element={session ? <div className="shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><Brand /><button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X /></button><div className="nav-label">WORKSPACE</div><nav>
        <NavLink to="/" icon={<LayoutDashboard />} label="Dashboard" close={() => setMobileOpen(false)} /><NavLink to="/keys" icon={<KeyRound />} label="Key Manage" close={() => setMobileOpen(false)} />{profile?.role === 'user' ? <NavLink to="/redeem" icon={<TicketCheck />} label="Redeem Key" close={() => setMobileOpen(false)} /> : profile?.role === 'developer' || profile?.role === 'admin' ? <NavLink to="/get-key" icon={<KeyRound />} label="Get Key" close={() => setMobileOpen(false)} /> : null}
      </nav><div className="sidebar-bottom">{profile?.role === 'admin' && <NavLink to="/admin" icon={<SettingsIcon />} label="Admin" close={() => setMobileOpen(false)} />}<NavLink to="/settings" icon={<SettingsIcon />} label="Settings" close={() => setMobileOpen(false)} /><button className="nav-item" onClick={() => void supabase!.auth.signOut()}><LogOut />Sign out</button></div></aside>
      {mobileOpen && <button aria-label="Close menu overlay" className="scrim" onClick={() => setMobileOpen(false)} />}
      <div className="main-column"><header className="topbar"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button><span className="crumb">BANANA HUB <span>/</span> WORKSPACE</span><button className="theme-toggle" aria-label={`Theme: ${theme}. Click to change`} onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>{theme === 'light' ? <Sun /> : <Moon />}<span>{theme}</span></button></header><main className="content"><Routes><Route path="/" element={<Dashboard profile={profile} />} /><Route path="/keys" element={<Keys profile={profile} />} /><Route path="/redeem" element={profile?.role === 'user' ? <Redeem /> : <Navigate to="/" replace />} /><Route path="/get-key" element={profile && profile.role !== 'user' ? <GetKey /> : <Navigate to="/" replace />} /><Route path="/settings" element={<SettingsPage profile={profile} theme={theme} setTheme={setTheme} />} /><Route path="/admin" element={profile?.role === 'admin' ? <AdminSettings /> : <Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main></div>
    </div> : <Navigate to="/login" replace />} />
  </Routes>
}

function Brand() { return <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">b.</span><span>banana hub</span></Link> }
function NavLink({ to, icon, label, close }: { to: string; icon: ReactNode; label: string; close: () => void }) { return <Link className="nav-item" to={to} onClick={close}>{icon}<span>{label}</span></Link> }
function Login() {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); setBusy(true); const { data, error: authError } = await supabase!.functions.invoke('username-login', { body: { username, password } }); if (authError || !data?.session) setError('Sign-in failed. Check your details or contact your administrator.'); else { const { error: sessionError } = await supabase!.auth.setSession(data.session); if (sessionError) setError('Could not establish your session. Please try again.') } setBusy(false) }
  async function discord() { setError(''); setBusy(true); const { error } = await supabase!.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: `${location.origin}/` } }); if (error) { setError('Discord sign-in failed. Check Discord provider settings in Supabase.'); setBusy(false) } }
  return <main className="login-page"><section className="login-panel"><Brand /><p className="overline">ACCESS PORTAL</p><h1>Sign in to your workspace.</h1><p className="muted">Manage keys issued through Banana Hub.</p><form onSubmit={submit}><label htmlFor="username">Username</label><input id="username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /><label htmlFor="password">Password</label><div className="password-field"><input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button type="button" className="text-button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form><div className="divider"><span>OR</span></div><button className="secondary-button full" disabled={busy} onClick={() => void discord()}>{busy ? 'Connecting…' : 'Continue with Discord'}</button><p className="login-note">Accounts are provisioned by your administrator.</p></section></main>
}
function PageTitle({ kicker, title, detail }: { kicker: string; title: string; detail: string }) { return <div className="page-title"><p className="overline">{kicker}</p><h1>{title}</h1><p className="muted">{detail}</p></div> }
function useKeys(profile: Profile | null) {
  return useQuery({ queryKey: ['keys', profile?.role], enabled: !!profile && !!supabase, queryFn: async (): Promise<KeyRow[]> => {
    const column = profile?.role === 'user' ? 'assigned_to' : 'generated_by'
    const { data: user } = await supabase!.auth.getUser(); if (!user.user) throw new Error('Session expired')
    let query = supabase!.from('keys').select('id,duration,status,created_at,expires_at,key_prefix,assigned_to,device_bound_at').order('created_at', { ascending: false }).limit(50)
    if (profile?.role !== 'admin') query = query.eq(column, user.user.id)
    const { data, error } = await query
    if (error) throw error
    return data as KeyRow[]
  } })
}
function KeyRows({ profile }: { profile: Profile | null }) {
  const { data, isLoading, error } = useKeys(profile)
  const queryClient = useQueryClient()
  if (isLoading) return <p className="state">Loading key activity…</p>
  if (error) return <p className="state error">Could not load keys. Refresh the page to try again.</p>
  if (!data?.length) return <div className="empty"><KeyRound /><p>No keys to show yet.</p><span>Keys associated with your account will appear here.</span></div>
  return <ul className="key-list">{data.map(row => <li key={row.id}><span className="key-id">{row.key_prefix}••••</span><span>{row.duration}</span><span className={`status ${row.status}`}>{row.expires_at && new Date(row.expires_at) < new Date() && row.status !== 'revoked' ? 'expired' : row.status}</span><time>{new Date(row.created_at).toLocaleDateString()}</time>{profile?.role === 'user' && row.status === 'redeemed' && <button className="secondary-button" onClick={() => void bindDevice(row.id, () => queryClient.invalidateQueries({ queryKey: ['keys', profile.role] }))}>{row.device_bound_at ? 'Device bound' : 'Bind this device'}</button>}{profile?.role && profile.role !== 'user' && row.assigned_to && <button className="secondary-button" onClick={() => void resetDevice(row.id, () => queryClient.invalidateQueries({ queryKey: ['keys', profile.role] }))}>Reset device</button>}</li>)}</ul>
}
async function deviceHash() {
  let id = localStorage.getItem('banana-install-id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('banana-install-id', id) }
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function bindDevice(id: string, refresh: () => unknown) { const { error } = await supabase!.rpc('bind_key_device', { p_key_id: id, p_device_hash: await deviceHash() }); if (error) window.alert(error.message.includes('device_mismatch') ? 'This key is already bound to another browser.' : 'Could not bind this device.'); else void refresh() }
async function resetDevice(id: string, refresh: () => unknown) { if (!window.confirm('Reset this key device binding? The next use will bind to a new browser.')) return; const { error } = await supabase!.rpc('reset_key_device', { p_key_id: id }); if (error) window.alert('Could not reset device binding. Check your permissions.'); else void refresh() }
function Dashboard({ profile }: { profile: Profile | null }) { return <><PageTitle kicker="OVERVIEW" title={`Welcome${profile?.username ? `, ${profile.username}` : ''}`} detail="A current view of your key activity." /><section className="data-section"><div className="section-heading"><h2>Key activity</h2></div><KeyRows profile={profile} /></section></> }
function Keys({ profile }: { profile: Profile | null }) { return <><PageTitle kicker="KEYS" title="Key Manage" detail="Review keys assigned to your account or generated by you." /><section className="data-section"><KeyRows profile={profile} /></section></> }
function Redeem() { const [value, setValue] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); async function redeem(e: FormEvent) { e.preventDefault(); setBusy(true); setMessage(''); const { error } = await supabase!.rpc('redeem_key', { p_key: value }); setMessage(error ? 'Key could not be redeemed. Check the key and try again.' : 'Key redeemed. Your key list will update shortly.'); setBusy(false) } return <><PageTitle kicker="REDEMPTION" title="Redeem Key" detail="Enter a key provided by a developer." /><form className="action-form" onSubmit={redeem}><label htmlFor="redeem-key">Access key</label><input id="redeem-key" required autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste your key" />{message && <p role="status" className="state">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Redeeming…' : 'Redeem key'}</button></form></> }
function GetKey() { const [duration, setDuration] = useState<'24h' | '7d' | '30d' | 'lifetime'>('24h'); const [result, setResult] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); async function generate() { setBusy(true); setResult(''); setMessage(''); const { data, error } = await supabase!.rpc('generate_key', { p_duration: duration }); if (error || !data || typeof data !== 'object' || !('key' in data)) setMessage('Key generation failed. Please try again.'); else setResult(String(data.key)); setBusy(false) } return <><PageTitle kicker="KEY ISSUANCE" title="Get Key" detail="Generate an access key. Validity begins immediately." /><section className="action-form"><label htmlFor="duration">Key duration</label><select id="duration" value={duration} onChange={e => setDuration(e.target.value as typeof duration)}><option value="24h">24 Hours</option><option value="7d">7 Days</option><option value="30d">30 Days</option><option value="lifetime">Lifetime</option></select><button className="primary-button" onClick={() => void generate()} disabled={busy}>{busy ? 'Generating…' : 'Generate key'}</button>{message && <p role="alert" className="form-error">{message}</p>}{result && <div className="generated"><label htmlFor="generated-key">New key, shown once</label><input id="generated-key" readOnly value={result} /><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(result)}>Copy key</button><p>Save this key now. It cannot be retrieved later.</p></div>}</section></> }
function SettingsPage({ profile, theme, setTheme }: { profile: Profile | null; theme: Theme; setTheme: (value: Theme) => void }) { return <><PageTitle kicker="PREFERENCES" title="Settings" detail="Account details and appearance." /><section className="settings-block"><h2>Appearance</h2><p className="muted">Choose how Banana Hub looks.</p><div className="theme-options">{(['dark', 'light', 'system'] as const).map(item => <button key={item} className={theme === item ? 'selected' : ''} onClick={() => setTheme(item)}>{item === 'dark' ? <Moon /> : <Sun />}{item[0].toUpperCase() + item.slice(1)}</button>)}</div></section><section className="settings-block"><h2>Account</h2><dl><div><dt>Username</dt><dd>{profile?.username ?? 'Unavailable'}</dd></div><div><dt>Role</dt><dd>{profile?.role ?? 'Unavailable'}</dd></div><div><dt>Discord ID</dt><dd>{profile?.discord_id ?? 'Not linked'}</dd></div></dl><button className="secondary-button" onClick={() => void supabase!.auth.signOut()}>Sign out</button></section></> }

function AdminSettings() {
  const [ids, setIds] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin-allowlist'], queryFn: async () => { const { data, error } = await supabase!.from('admin_allowlist').select('discord_id').order('created_at'); if (error) throw error; return data.map(row => row.discord_id) } })
  async function save(event: FormEvent) { event.preventDefault(); const values = ids.split(/[\s,]+/).map(v => v.trim()).filter(Boolean); if (!values.length || values.some(v => !/^\d{15,22}$/.test(v))) { setMessage('Enter one or more numeric Discord IDs.'); return }; setBusy(true); const { error } = await supabase!.rpc('set_discord_admin_allowlist', { p_ids: values }); setMessage(error ? 'Could not update admin access.' : 'Admin access updated. Sign out and back in for role changes.'); if (!error) void refetch(); setBusy(false) }
  return <><PageTitle kicker="ACCESS CONTROL" title="Admin configuration" detail="Admin IDs are stored in private database configuration, not public environment variables." /><section className="settings-block"><h2>Discord admin IDs</h2>{isLoading ? <p className="state">Loading admin list…</p> : error ? <p className="state error">Could not load admin list.</p> : <p className="muted">Current allowlist: {data?.length ? data.join(', ') : 'empty'}</p>}<form className="action-form" onSubmit={save}><label htmlFor="admin-ids">Numeric Discord user IDs, separated by commas</label><textarea id="admin-ids" rows={3} required value={ids} onChange={e => setIds(e.target.value)} placeholder="Discord user ID" /><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save admin IDs'}</button>{message && <p className="state" role="status">{message}</p>}</form><p className="muted">Replacing the list changes admin roles. Keep at least one trusted ID.</p></section></>
}
