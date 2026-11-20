import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useTransform } from 'motion/react'
import type { Transition } from 'motion/react'
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Copy,
  Crown,
  Gamepad2,
  HardDrive,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  RotateCcw,
  Settings as SettingsIcon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Tag,
  TerminalSquare,
  TicketCheck,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import bananaLogo from './Public/Bananalogo.png'

type Theme = 'dark' | 'light'
type Profile = { username: string; discord_username: string | null; role: 'user' | 'developer' | 'admin'; discord_id: string | null; preferred_theme: Theme }
type KeyRow = { id: string; duration: string; status: string; created_at: string; redeemed_at: string | null; expires_at: string | null; key_prefix: string; assigned_to: string | null; device_bound_at: string | null }
type Toast = { kind: 'success' | 'error'; text: string }

/* Motion language: springs for spatial changes (sidebar, modals, indicators),
   short eased fades for page swaps. Every animation marks a real state change. */
const spring: Transition = { type: 'spring', stiffness: 340, damping: 32 }
const pageTransition: Transition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
const SIDEBAR_FULL = 250
const SIDEBAR_MINI = 76
const SIDEBAR_MOBILE = 280

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('banana-theme')
    return saved === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('banana-theme', theme)
    if (supabase) void supabase.auth.getUser().then(({ data }) => { if (data.user) void supabase!.from('profiles').update({ preferred_theme: theme }).eq('id', data.user.id).then(() => {}) })
  }, [theme])
  return [theme, setTheme] as const
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 680px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 680px)')
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3400)
    return () => clearTimeout(timer)
  }, [toast])
  return [toast, setToast] as const
}

function isKeyActive(row: KeyRow): boolean {
  if (!row.assigned_to || row.status === 'revoked' || row.status === 'expired') return false
  if (row.duration === 'lifetime' || !row.expires_at) return row.status === 'redeemed'
  return row.status === 'redeemed' && new Date(row.expires_at).getTime() > Date.now()
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
function formatDuration(duration: string) {
  if (duration === '24h') return '24 hours'
  if (duration === '48h') return '2 days'
  if (duration === '7d') return '7 days'
  if (duration === '30d') return '30 days'
  return 'Lifetime'
}
function formatRemaining(expiresAt: string, now: number) {
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return 'Expired'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${minutes}m left`
  if (minutes > 0) return `${minutes}m ${seconds}s left`
  return `${seconds}s left`
}
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const [session, setSession] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('banana-sidebar-collapsed') === 'true'
  })
  const isMobile = useIsMobile()
  const location = useLocation()

  function toggleSidebar() {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('banana-sidebar-collapsed', String(next))
      return next
    })
  }

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

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [mobileOpen])

  async function loadProfile(id: string) {
    setProfileError(false)
    const { data } = await supabase!.from('profiles').select('username,discord_username,role,discord_id,preferred_theme').eq('id', id).maybeSingle()
    if (data) { const value = data as Profile; setProfile(value); if (value.preferred_theme === 'light' || value.preferred_theme === 'dark') setTheme(value.preferred_theme) }
    else {
      await supabase!.rpc('ensure_my_profile')
      const { data: created } = await supabase!.from('profiles').select('username,discord_username,role,discord_id,preferred_theme').eq('id', id).maybeSingle()
      if (created) { const value = created as Profile; setProfile(value); if (value.preferred_theme === 'light' || value.preferred_theme === 'dark') setTheme(value.preferred_theme) }
      else setProfileError(true)
    }
  }

  /* Wait for the profile before rendering role-gated UI, so a loading or
     failed fetch never flashes the wrong role's nav or redirects. */
  if (session === null || (session && !profile && !profileError)) return (
    <motion.main
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="loading"
    >
      <div className="loading-spinner" />
      <span>Restoring your session…</span>
    </motion.main>
  )

  if (session && profileError) return (
    <main className="loading">
      <div className="state-box error">
        <ShieldAlert />
        <p className="state">Could not load your profile. Check your connection and try again.</p>
        <button
          className="secondary-button"
          onClick={() => void supabase!.auth.getSession().then(({ data }) => { if (data.session) void loadProfile(data.session.user.id) })}
        >
          <RotateCcw size={15} /> Retry
        </button>
      </div>
    </main>
  )

  if (!supabase) return (
    <main className="setup">
      <Brand />
      <h1>Connect your Supabase project</h1>
      <p>Add your project URL and publishable key to <code>.env</code>. Apply the included migration before signing in.</p>
      <code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code>
    </main>
  )

  const crumbLabel =
    location.pathname === '/keys' ? 'KEY MANAGE'
    : location.pathname === '/redeem' ? 'REDEEM'
    : location.pathname === '/pricing' ? 'PRICING'
    : location.pathname === '/get-key' ? 'GET KEY'
    : location.pathname === '/settings' ? 'SETTINGS'
    : location.pathname === '/admin' ? 'ADMIN'
    : 'DASHBOARD'

  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login theme={theme} setTheme={setTheme} />} />
        <Route
          path="*"
          element={
            session ? (
              <div className="shell">
                <motion.aside
                  className="sidebar"
                  initial={false}
                  animate={isMobile
                    ? { x: mobileOpen ? 0 : -(SIDEBAR_MOBILE + 24), width: SIDEBAR_MOBILE }
                    : { x: 0, width: sidebarCollapsed ? SIDEBAR_MINI : SIDEBAR_FULL }}
                  transition={spring}
                  inert={isMobile && !mobileOpen}
                >
                  <div className="sidebar-header">
                    <Brand collapsed={!isMobile && sidebarCollapsed} />
                    <button
                      className="mobile-close icon-button"
                      aria-label="Close navigation"
                      onClick={() => setMobileOpen(false)}
                    >
                      <X />
                    </button>
                  </div>

                  {(!isMobile && sidebarCollapsed)
                    ? <span className="nav-divider" aria-hidden="true" />
                    : <div className="nav-label">WORKSPACE</div>}

                  <nav aria-label="Workspace" onClick={() => { if (isMobile) setMobileOpen(false) }}>
                    <NavLink to="/" icon={<LayoutDashboard />} label="Dashboard" collapsed={!isMobile && sidebarCollapsed} />
                    <NavLink to="/keys" icon={<KeyRound />} label="Key Manage" collapsed={!isMobile && sidebarCollapsed} />
                    {profile?.role === 'user' ? (
                      <RedeemNav collapsed={!isMobile && sidebarCollapsed} />
                    ) : profile?.role === 'developer' || profile?.role === 'admin' ? (
                      <NavLink to="/get-key" icon={<TicketCheck />} label="Get Key" collapsed={!isMobile && sidebarCollapsed} />
                    ) : null}
                    <NavLink to="/pricing" icon={<Tag />} label="Pricing" collapsed={!isMobile && sidebarCollapsed} />
                  </nav>

                  <div className="sidebar-bottom" onClick={() => { if (isMobile) setMobileOpen(false) }}>
                    {profile?.role === 'admin' && (
                      <NavLink to="/admin" icon={<ShieldCheck />} label="Admin" collapsed={!isMobile && sidebarCollapsed} />
                    )}
                    <NavLink to="/settings" icon={<SettingsIcon />} label="Settings" collapsed={!isMobile && sidebarCollapsed} />
                    <button
                      className={`nav-item ${!isMobile && sidebarCollapsed ? 'collapsed' : ''}`}
                      title={!isMobile && sidebarCollapsed ? 'Sign out' : undefined}
                      onClick={() => void supabase!.auth.signOut()}
                    >
                      <span className="nav-icon"><LogOut /></span>
                      <AnimatePresence initial={false}>
                        {(isMobile || !sidebarCollapsed) && (
                          <motion.span className="nav-text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                            Sign out
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </button>

                    {!isMobile && (
                      <button
                        type="button"
                        className={`nav-item collapse-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
                        onClick={toggleSidebar}
                        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
                        title={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
                      >
                        <motion.span className="nav-icon" animate={{ rotate: sidebarCollapsed ? 180 : 0 }} transition={spring}>
                          <ChevronLeft />
                        </motion.span>
                        <AnimatePresence initial={false}>
                          {!sidebarCollapsed && (
                            <motion.span className="nav-text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                              Collapse
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    )}
                  </div>
                </motion.aside>

                <AnimatePresence>
                  {isMobile && mobileOpen && (
                    <motion.button
                      key="scrim"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      aria-label="Close menu overlay"
                      className="scrim"
                      onClick={() => setMobileOpen(false)}
                    />
                  )}
                </AnimatePresence>

                <motion.div
                  className="main-column"
                  initial={false}
                  animate={{ marginLeft: isMobile ? 0 : sidebarCollapsed ? SIDEBAR_MINI : SIDEBAR_FULL }}
                  transition={spring}
                >
                  <header className="topbar">
                    <div className="topbar-left">
                      <button
                        className="icon-button menu-toggle"
                        aria-label="Open navigation"
                        onClick={() => setMobileOpen(true)}
                      >
                        <Menu />
                      </button>
                      <span className="crumb">BANANA HUB <span>/</span> {crumbLabel}</span>
                    </div>
                    <ThemeToggle theme={theme} setTheme={setTheme} />
                  </header>

                  <main className="content">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={pageTransition}
                      >
                        <Routes location={location}>
                          <Route path="/" element={<Dashboard profile={profile} />} />
                          <Route path="/keys" element={<Keys profile={profile} />} />
                          <Route
                            path="/redeem"
                            element={profile?.role === 'user' ? <Redeem profile={profile} /> : <Navigate to="/" replace />}
                          />
                          <Route path="/pricing" element={<Pricing profile={profile} />} />
                          <Route
                            path="/get-key"
                            element={profile && profile.role !== 'user' ? <GetKey /> : <Navigate to="/" replace />}
                          />
                          <Route
                            path="/settings"
                            element={<SettingsPage profile={profile} theme={theme} setTheme={setTheme} />}
                          />
                          <Route
                            path="/admin"
                            element={profile?.role === 'admin' ? <AdminSettings /> : <Navigate to="/" replace />}
                          />
                          <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                      </motion.div>
                    </AnimatePresence>
                  </main>
                </motion.div>
              </div>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </MotionConfig>
  )
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link className={`brand ${collapsed ? 'collapsed' : ''}`} to="/" title="Banana Hub">
      <img src={bananaLogo} alt="Banana Hub" width={32} height={32} className="brand-img" />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            Banana Hub
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  )
}

function ThemeToggle({ theme, setTheme, className = '' }: { theme: Theme; setTheme: (value: Theme) => void; className?: string }) {
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      className={`theme-switcher ${className}`}
      aria-label={`Current theme: ${theme}. Click to switch to ${nextTheme} theme`}
      onClick={() => setTheme(nextTheme)}
    >
      <span className="theme-switcher-track" aria-hidden="true">
        <motion.span
          className="theme-switcher-thumb"
          animate={{ x: theme === 'light' ? 18 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          {theme === 'light' ? <Sun className="theme-icon" /> : <Moon className="theme-icon" />}
        </motion.span>
      </span>
      <span className="theme-switcher-label">{theme}</span>
    </motion.button>
  )
}

function NavLink({ to, icon, label, collapsed = false }: { to: string; icon: ReactNode; label: string; collapsed?: boolean }) {
  const { pathname } = useLocation()
  const active = pathname === to
  return (
    <Link
      className={`nav-item ${active ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}
      to={to}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {active && <motion.span layoutId="nav-active" className="nav-pill" transition={spring} aria-hidden="true" />}
      <span className="nav-icon">{icon}</span>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span className="nav-text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  )
}

function RedeemNav({ collapsed = false }: { collapsed?: boolean }) {
  return <NavLink to="/redeem" icon={<TicketCheck />} label="Redeem Key" collapsed={collapsed} />
}

function DiscordIcon() {
  return (
    <svg className="discord-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

function Login({ theme, setTheme }: { theme: Theme; setTheme: (value: Theme) => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    const cleanUser = username.trim()
    try {
      const { data, error: authError } = await supabase!.functions.invoke('username-login', { body: { username: cleanUser, password } })
      if (!authError && data?.session) {
        const { error: sessionError } = await supabase!.auth.setSession(data.session)
        if (sessionError) setError('Could not establish your session. Please try again.')
        return
      }
      const targetEmail = cleanUser.includes('@') ? cleanUser : cleanUser === 'user' ? 'userdemo@bananahub.com' : `${cleanUser}@bananahub.local`
      const { data: directData, error: directError } = await supabase!.auth.signInWithPassword({ email: targetEmail, password })
      if (directError || !directData.session) {
        setError('Sign-in failed. Check your details or contact your administrator.')
      }
    } catch {
      try {
        const targetEmail = cleanUser.includes('@') ? cleanUser : cleanUser === 'user' ? 'userdemo@bananahub.com' : `${cleanUser}@bananahub.local`
        const { data: directData, error: directError } = await supabase!.auth.signInWithPassword({ email: targetEmail, password })
        if (directError || !directData.session) {
          setError('Sign-in failed. Check your details or contact your administrator.')
        }
      } catch {
        setError('Sign-in service unavailable. Please try again.')
      }
    } finally { setBusy(false) }
  }
  async function discord() {
    setError(''); setBusy(true)
    const { error } = await supabase!.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: `${location.origin}/` } })
    if (error) { setError('Discord sign-in failed. Check Discord provider settings in Supabase.'); setBusy(false) }
  }
  return (
    <main className="login-page">
      <div className="login-theme-bar">
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>

      <motion.section
        className="login-panel"
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="login-brand-header">
          <motion.div
            className="login-logo-container"
            whileHover={{ scale: 1.06, rotate: 2 }}
            transition={{ type: 'spring', stiffness: 350, damping: 15 }}
          >
            <img src={bananaLogo} alt="Banana Hub" width={68} height={68} className="login-logo-img" />
          </motion.div>
          <p className="overline">WORKSPACE ACCESS</p>
          <h1 className="login-title">Sign in to Banana Hub</h1>
          <p className="login-desc">Enter your account credentials or continue with Discord.</p>
        </div>

        <form onSubmit={submit} className="login-form">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            autoComplete="username"
            required
            placeholder="Enter username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />

          <label htmlFor="password">Password</label>
          <div className="password-field">
            <input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setShow(!show)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                className="form-error"
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="primary-button full"
            disabled={busy}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </motion.button>
        </form>

        <div className="divider"><span>OR</span></div>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="secondary-button full discord-btn"
          disabled={busy}
          onClick={() => void discord()}
        >
          <DiscordIcon />
          <span>{busy ? 'Connecting…' : 'Continue with Discord'}</span>
        </motion.button>

        <p className="login-note">Accounts are provisioned by your administrator.</p>
      </motion.section>
    </main>
  )
}

function PageTitle({ kicker, title, detail }: { kicker: string; title: string; detail: string }) {
  return (
    <motion.div
      className="page-title"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <p className="overline">{kicker}</p>
      <h1>{title}</h1>
      <p className="muted">{detail}</p>
    </motion.div>
  )
}

function useKeys(profile: Profile | null) {
  return useQuery({
    queryKey: ['keys', profile?.role],
    enabled: !!profile && !!supabase,
    refetchInterval: 8000,
    queryFn: async (): Promise<KeyRow[]> => {
      const column = profile?.role === 'user' ? 'assigned_to' : 'generated_by'
      const { data: user } = await supabase!.auth.getUser()
      if (!user.user) throw new Error('Session expired')
      let query = supabase!
        .from('keys')
        .select('id,duration,status,created_at,redeemed_at,expires_at,key_prefix,assigned_to,device_bound_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50)
      if (profile?.role === 'admin') query = query.or(`generated_by.eq.${user.user.id},assigned_to.eq.${user.user.id}`)
      else query = query.eq(column, user.user.id)
      const { data, error } = await query
      if (error) throw error
      return data as KeyRow[]
    },
  })
}

function AnimatedNumber({ value }: { value: number }) {
  const motionValue = useMotionValue(0)
  const rounded = useTransform(() => Math.round(motionValue.get()))
  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.7, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [value, motionValue])
  return <motion.span>{rounded}</motion.span>
}

function ToastView({ toast }: { toast: Toast }) {
  return (
    <motion.div
      className={`toast ${toast.kind}`}
      role="status"
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={spring}
    >
      {toast.kind === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
      <span>{toast.text}</span>
    </motion.div>
  )
}

function Modal({ onClose, labelledBy, children }: { onClose: () => void; labelledBy: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const backs = document.querySelectorAll('.modal-backdrop')
        if (backs[backs.length - 1] === panelRef.current?.parentElement) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hasAttribute('disabled'))
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus()
    }
  }, [])
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={() => onCloseRef.current()}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="modal-panel"
        initial={{ opacity: 0, y: 26, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={spring}
        onClick={event => event.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function DeviceBadge({ bound }: { bound: boolean }) {
  return (
    <span className={`device-status-badge ${bound ? 'bound' : 'unbound'}`}>
      {bound ? <CheckCircle2 size={13} /> : <Shield size={13} />}
      {bound ? 'Device linked' : 'No device linked'}
    </span>
  )
}

function KeyDetailModal({ row, profile, now, onClose, onReset, onCopied }: {
  row: KeyRow
  profile: Profile | null
  now: number
  onClose: () => void
  onReset: () => void
  onCopied: (ok: boolean) => void
}) {
  const isBound = Boolean(row.device_bound_at)
  const isLifetime = row.duration === 'lifetime' || !row.expires_at
  const isExpired = Boolean(row.expires_at && new Date(row.expires_at).getTime() <= now)
  const canReset = profile?.role === 'user' && row.status === 'redeemed' && !isExpired
  const savedKey = localStorage.getItem(`banana-redeemed-key:${row.id}`) || ''
  const remaining = !isLifetime && row.expires_at ? formatRemaining(row.expires_at, now) : null
  const urgent = Boolean(row.expires_at && new Date(row.expires_at).getTime() - now < 86400000 && new Date(row.expires_at).getTime() > now)
  return (
    <Modal onClose={onClose} labelledBy="key-detail-title">
      <header className="modal-head">
        <div>
          <p className="overline">KEY DETAILS</p>
          <h2 id="key-detail-title" className="modal-key-title">
            <KeyRound size={17} aria-hidden="true" />
            {row.key_prefix}••••••••
          </h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close key details" autoFocus>
          <X />
        </button>
      </header>

      <dl className="detail-list">
        <div>
          <dt><ShieldCheck size={14} aria-hidden="true" /> Status</dt>
          <dd><span className={`status-pill ${isExpired ? 'expired' : row.status}`}>{isExpired ? 'expired' : row.status}</span></dd>
        </div>
        <div>
          <dt><Clock size={14} aria-hidden="true" /> Duration</dt>
          <dd>{formatDuration(row.duration)}</dd>
        </div>
        <div>
          <dt><CalendarDays size={14} aria-hidden="true" /> Created</dt>
          <dd>{formatDateTime(row.created_at)}</dd>
        </div>
        <div>
          <dt><TicketCheck size={14} aria-hidden="true" /> Redeemed</dt>
          <dd>{row.redeemed_at ? formatDateTime(row.redeemed_at) : 'Not redeemed yet'}</dd>
        </div>
        <div>
          <dt><Clock size={14} aria-hidden="true" /> Expires</dt>
          <dd>{isLifetime ? 'Never, lifetime key' : row.expires_at ? formatDateTime(row.expires_at) : 'Not set'}</dd>
        </div>
        {remaining && (
          <div>
            <dt><Clock size={14} aria-hidden="true" /> Time left</dt>
            <dd className={isExpired || urgent ? 'warn-text' : 'accent-text'}>{remaining}</dd>
          </div>
        )}
      </dl>

      <section className={`device-panel ${isBound ? 'bound' : ''}`}>
        <div className="device-panel-icon">
          <MonitorSmartphone size={20} aria-hidden="true" />
        </div>
        <div className="device-panel-copy">
          <h3>{isBound ? 'This key is linked to a device' : 'This key is not linked to any device'}</h3>
          <p className="muted">
            {isBound
              ? `Linked on ${formatDateTime(row.device_bound_at!)}. The key only runs on that device until you reset it.`
              : 'The first executor that uses this key will bind its device automatically.'}
          </p>
        </div>
        {canReset && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="secondary-button reset-dev-btn"
            disabled={!isBound}
            onClick={onReset}
            title={isBound ? 'Clear the device binding so the key can bind a new device' : 'No device is bound to this key'}
          >
            <RotateCcw size={14} />
            Reset Device
          </motion.button>
        )}
      </section>

      <footer className="modal-actions">
        {savedKey ? (
          <button
            className="secondary-button"
            onClick={() => void copyText(savedKey).then(onCopied)}
          >
            <Copy size={14} />
            Copy Full Key
          </button>
        ) : (
          <span className="saved-key-note">The full key is only shown at redemption.</span>
        )}
        <button className="primary-button" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  )
}

function ConfirmResetDialog({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal onClose={onCancel} labelledBy="confirm-reset-title">
      <div className="confirm-body">
        <div className="confirm-icon" aria-hidden="true"><RotateCcw size={22} /></div>
        <h2 id="confirm-reset-title">Reset device binding?</h2>
        <p className="muted">
          The current device link will be cleared. The next Lua executor that uses this key will immediately bind a new device.
        </p>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="danger-button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            <RotateCcw size={15} className={busy ? 'spinning' : ''} />
            {busy ? 'Resetting…' : 'Yes, reset device'}
          </motion.button>
        </div>
      </div>
    </Modal>
  )
}

function ConfirmDeleteDialog({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal onClose={onCancel} labelledBy="confirm-delete-title">
      <div className="confirm-body">
        <div className="confirm-icon" aria-hidden="true"><Trash2 size={22} /></div>
        <h2 id="confirm-delete-title">Delete expired key?</h2>
        <p className="muted">
          This permanently removes the key from your account. This action cannot be undone.
        </p>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="danger-button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            <Trash2 size={15} className={busy ? 'spinning' : ''} />
            {busy ? 'Deleting…' : 'Yes, delete key'}
          </motion.button>
        </div>
      </div>
    </Modal>
  )
}

function KeyRows({ profile }: { profile: Profile | null }) {
  const { data, isLoading, error, refetch } = useKeys(profile)
  const queryClient = useQueryClient()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useToast()
  const now = useNow()

  const visible = data
  const detailRow = data?.find(row => row.id === detailId) ?? null
  const confirmRow = data?.find(row => row.id === confirmResetId) ?? null
  const deleteRow = data?.find(row => row.id === confirmDeleteId) ?? null

  async function resetDevice(keyId: string) {
    setResetting(true)
    try {
      const { error: resetError } = await supabase!.rpc('reset_my_key_device', { p_key_id: keyId })
      if (resetError) {
        setToast({
          kind: 'error',
          text: resetError.message.includes('key_unavailable')
            ? 'This key can no longer be reset.'
            : 'Could not reset the device. Please try again.',
        })
      } else {
        setToast({ kind: 'success', text: 'Device binding cleared. The next executor will bind a new device.' })
        setConfirmResetId(null)
        await queryClient.invalidateQueries({ queryKey: ['keys', profile?.role] })
      }
    } catch {
      setToast({ kind: 'error', text: 'Connection error while resetting the device.' })
    } finally {
      setResetting(false)
    }
  }

  async function deleteKey(keyId: string) {
    setDeleting(true)
    try {
      const { error: deleteError } = await supabase!.rpc('delete_expired_key', { p_key_id: keyId })
      if (deleteError) {
        setToast({
          kind: 'error',
          text: deleteError.message.includes('key_unavailable')
            ? 'Only expired keys can be deleted.'
            : 'Could not delete the key. Please try again.',
        })
      } else {
        localStorage.removeItem(`banana-redeemed-key:${keyId}`)
        setToast({ kind: 'success', text: 'Expired key deleted.' })
        setConfirmDeleteId(null)
        if (detailId === keyId) setDetailId(null)
        await queryClient.invalidateQueries({ queryKey: ['keys', profile?.role] })
      }
    } catch {
      setToast({ kind: 'error', text: 'Connection error while deleting the key.' })
    } finally {
      setDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="state-box">
        <div className="loading-spinner" />
        <p className="state">Loading your keys and device links…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="state-box error">
        <ShieldAlert />
        <p className="state error">Could not load keys. Check your connection and retry.</p>
        <button className="secondary-button" onClick={() => void refetch()}>
          <RotateCcw size={14} />
          Retry
        </button>
      </div>
    )
  }

  if (!visible?.length) {
    return (
      <motion.div
        className="empty"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring}
      >
        <KeyRound />
        <p>No keys found</p>
        <span>
          {profile?.role === 'user'
            ? 'Redeem a valid access key to see it here with its expiry and device link.'
            : 'Generate a key from the Get Key page to see it listed here.'}
        </span>
        {profile?.role === 'user'
          ? <Link className="primary-button empty-action" to="/redeem">Redeem a key <ArrowRight size={15} /></Link>
          : <Link className="primary-button empty-action" to="/get-key">Generate a key <ArrowRight size={15} /></Link>}
      </motion.div>
    )
  }

  return (
    <div className="keys-container">
      <motion.div className="keys-grid">
        <AnimatePresence>
          {visible.map((row, index) => {
            const isBound = Boolean(row.device_bound_at)
            const isLifetime = row.duration === 'lifetime' || !row.expires_at
            const isExpired = Boolean(row.expires_at && new Date(row.expires_at).getTime() <= now)
            const remaining = !isLifetime && row.expires_at && !isExpired ? formatRemaining(row.expires_at, now) : null
            const urgent = Boolean(row.expires_at && new Date(row.expires_at).getTime() - now < 86400000 && !isExpired)
            const canReset = profile?.role === 'user' && row.status === 'redeemed' && !isExpired
            const canDelete = profile?.role === 'user' && row.status !== 'revoked' && isExpired

            return (
              <motion.article
                layout
                key={row.id}
                className={`key-card ${isExpired ? 'expired' : ''}`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(index, 8) * 0.05 } }}
                transition={spring}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              >
                <div className="key-card-header">
                  <div className="key-badge-group">
                    <span className="key-code">
                      <KeyRound size={14} className="key-icon" aria-hidden="true" />
                      {row.key_prefix}••••••••
                    </span>
                    <span className={`status-pill ${isExpired ? 'expired' : row.status}`}>{isExpired ? 'expired' : row.status}</span>
                  </div>
                  <span className="duration-pill">
                    <Clock size={12} aria-hidden="true" />
                    {formatDuration(row.duration)}
                  </span>
                </div>

                <div className="key-details-table">
                  <div className="detail-item">
                    <span className="detail-label">
                      <HardDrive size={13} aria-hidden="true" />
                      Device
                    </span>
                    <DeviceBadge bound={isBound} />
                  </div>

                  <div className="detail-item">
                    <span className="detail-label">
                      <Clock size={13} aria-hidden="true" />
                      Expires
                    </span>
                    <span className="detail-value highlight">
                      {isLifetime ? 'Lifetime access' : row.expires_at ? formatDate(row.expires_at) : 'Never'}
                    </span>
                  </div>

                  {remaining && (
                    <div className="detail-item">
                      <span className="detail-label">
                        <Clock size={13} aria-hidden="true" />
                        Time left
                      </span>
                      <span className={`detail-value countdown ${urgent ? 'warn-text' : 'accent-text'}`}>{remaining}</span>
                    </div>
                  )}

                  <div className="detail-item">
                    <span className="detail-label">
                      <CalendarDays size={13} aria-hidden="true" />
                      Created
                    </span>
                    <span className="detail-value">{formatDate(row.created_at)}</span>
                  </div>

                  {row.device_bound_at && (
                    <div className="detail-item">
                      <span className="detail-label">
                        <MonitorSmartphone size={13} aria-hidden="true" />
                        Linked on
                      </span>
                      <span className="detail-value">{formatDateTime(row.device_bound_at)}</span>
                    </div>
                  )}
                </div>

                <div className="key-card-actions">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    className="secondary-button"
                    onClick={() => setDetailId(row.id)}
                  >
                    <Info size={14} />
                    Details
                  </motion.button>

                  <SavedRedeemedKey
                    keyId={row.id}
                    onCopied={ok => setToast(ok
                      ? { kind: 'success', text: 'Full key copied to clipboard.' }
                      : { kind: 'error', text: 'Copy failed. Your browser blocked clipboard access.' })}
                  />

                  {canReset && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="secondary-button reset-dev-btn"
                      disabled={!isBound}
                      onClick={() => setConfirmResetId(row.id)}
                      title={isBound ? 'Clear the device binding so the key can bind a new device' : 'No device is bound to this key'}
                    >
                      <RotateCcw size={14} />
                      Reset Device
                    </motion.button>
                  )}

                  {canDelete && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="secondary-button reset-dev-btn"
                      onClick={() => setConfirmDeleteId(row.id)}
                      title="Permanently remove this expired key from your account"
                    >
                      <Trash2 size={14} />
                      Delete
                    </motion.button>
                  )}
                </div>
              </motion.article>
            )
          })}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {detailRow && (
          <KeyDetailModal
            key="key-detail"
            row={detailRow}
            profile={profile}
            now={now}
            onClose={() => setDetailId(null)}
            onReset={() => setConfirmResetId(detailRow.id)}
            onCopied={ok => setToast(ok
              ? { kind: 'success', text: 'Full key copied to clipboard.' }
              : { kind: 'error', text: 'Copy failed. Your browser blocked clipboard access.' })}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmRow && (
          <ConfirmResetDialog
            key="confirm-reset"
            busy={resetting}
            onCancel={() => { if (!resetting) setConfirmResetId(null) }}
            onConfirm={() => void resetDevice(confirmRow.id)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteRow && (
          <ConfirmDeleteDialog
            key="confirm-delete"
            busy={deleting}
            onCancel={() => { if (!deleting) setConfirmDeleteId(null) }}
            onConfirm={() => void deleteKey(deleteRow.id)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && <ToastView key="toast" toast={toast} />}
      </AnimatePresence>
    </div>
  )
}

function SavedRedeemedKey({ keyId, onCopied }: { keyId: string; onCopied: (ok: boolean) => void }) {
  const [key] = useState(() => localStorage.getItem(`banana-redeemed-key:${keyId}`) || '')
  if (!key) return null
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className="secondary-button copy-key-btn"
      onClick={() => void copyText(key).then(onCopied)}
    >
      <Copy size={14} />
      Copy Key
    </motion.button>
  )
}

type GameTier = 'free' | 'premium'

type SupportedGame = {
  id: string
  name: string
  genre: string
  icon: string
  tiers: GameTier[]
  description: string
  url: string
}

// ponytail: icon URLs are Roblox CDN links valid ~180 days; swap to a runtime
// thumbnails.roblox.com lookup if the list ever outlives them.
const SUPPORTED_GAMES: SupportedGame[] = [
  { id: 'dds', name: 'DDS', genre: 'Drag Racing RP', icon: 'https://tr.rbxcdn.com/180DAY-739e5f98daa0d50c8a331c5ba7678b58/256/256/Image/Png/noFilter', tiers: ['premium'], description: 'Drag Drive Simulator: realistic driving, drag runs, and street roleplay with your crew.', url: 'https://www.roblox.com/games/131378148336503/Drag-Drive-Simulator' },
  { id: 'mt-soreya', name: 'MT SOREYA', genre: 'Climb & Fish', icon: 'https://tr.rbxcdn.com/180DAY-e063649024fc42a9ff849df4d676cac8/256/256/Image/Png/noFilter', tiers: ['free', 'premium'], description: 'Climb 13 checkpoints to the summit, fish rarity tiers with mutations, and chase hourly luck events.', url: 'https://www.roblox.com/games/118517641508250/MOUNT-SOREYA' },
  { id: 'violence-district', name: 'Violence District', genre: 'Asym Horror', icon: 'https://tr.rbxcdn.com/180DAY-09da8a9c4c14139a7c5af5890a36787e/256/256/Image/Png/noFilter', tiers: ['free'], description: 'Casual asymmetrical horror: five survivors outlast one killer across the district.', url: 'https://www.roblox.com/games/93978595733734/Violence-District' },
  { id: 'throw-food', name: 'Throw Food For Animals', genre: 'Throw Simulator', icon: 'https://tr.rbxcdn.com/180DAY-eeb61048a8ee1bf008f1d14f7f501166/256/256/Image/Png/noFilter', tiers: ['free'], description: 'Throw food to attract and collect animals, earn cash, and train throw power for rarer catches.', url: 'https://www.roblox.com/games/120219252362013/Throw-Food-For-Animals' },
]

const LOADERS = [
  { tier: 'free', detail: 'Covers Violence District and Throw Food For Animals.', code: 'loadstring(game:HttpGet("https://raw.githubusercontent.com/aerizuu/BananaHUB/refs/heads/main/BananaLoaderFree.lua"))()' },
  { tier: 'premium', detail: 'Covers DDS, MT SOREYA, and both free games.', code: 'loadstring(game:HttpGet("https://raw.githubusercontent.com/aerizuu/BananaHUB/refs/heads/main/BananaLoaderPrem.lua"))()' },
] as const

function LoaderCard({ loader, index }: { loader: (typeof LOADERS)[number]; index: number }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    const ok = await copyText(loader.code)
    setCopied(ok)
    setFailed(!ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      className={loader.tier === 'premium' ? 'loader-card premium' : 'loader-card'}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { ...spring, delay: index * 0.05 } }}
    >
      <div className="loader-head">
        <span className={`tier-badge tier-${loader.tier}`}>
          {loader.tier === 'premium' && <Crown className="tier-icon" aria-hidden="true" />}
          {loader.tier === 'premium' ? 'PREMIUM' : 'FREE'}
        </span>
        <button
          className={copied ? 'secondary-button loader-copy copied' : 'secondary-button loader-copy'}
          onClick={() => void copy()}
          aria-label={`Copy ${loader.tier} loadstring`}
        >
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy loadstring'}
        </button>
      </div>
      <code className="loader-code">{loader.code}</code>
      <p className="loader-note">{failed ? 'Copy failed. Select the code and copy it manually.' : loader.detail}</p>
    </motion.div>
  )
}

function Dashboard({ profile }: { profile: Profile | null }) {
  const { data: keys, isLoading, error, refetch } = useKeys(profile)
  const now = useNow()
  const name = profile?.discord_username || profile?.username
  const isStaff = profile?.role === 'developer' || profile?.role === 'admin'
  const activeKey = keys?.find(isKeyActive)

  return (
    <>
      <PageTitle
        kicker="OVERVIEW"
        title={`Welcome${name ? `, ${name}` : ''}`}
        detail={isStaff ? 'Key statistics and every game covered by Banana Hub scripts.' : 'Your license status and every game covered by Banana Hub scripts.'}
      />

      {isStaff ? (
        <div className="dashboard-stats">
          {isLoading ? (
            <div className="state-box"><div className="loading-spinner" /><p className="state">Loading key statistics…</p></div>
          ) : error ? (
            <div className="state-box error">
              <ShieldAlert />
              <p className="state error">Could not load key statistics.</p>
              <button className="secondary-button" onClick={() => void refetch()}><RotateCcw size={14} /> Retry</button>
            </div>
          ) : (
            <>
              <motion.div className="stat-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                <span className="stat-value"><AnimatedNumber value={keys?.length ?? 0} /></span>
                <span className="stat-label"><KeyRound size={14} aria-hidden="true" /> Total keys</span>
              </motion.div>
              <motion.div className="stat-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: { ...spring, delay: 0.05 } }}>
                <span className="stat-value"><AnimatedNumber value={keys?.filter(k => k.status === 'available').length ?? 0} /></span>
                <span className="stat-label"><Clock size={14} aria-hidden="true" /> Available to redeem</span>
              </motion.div>
              <motion.div className="stat-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: { ...spring, delay: 0.1 } }}>
                <span className="stat-value"><AnimatedNumber value={keys?.filter(k => k.status === 'redeemed').length ?? 0} /></span>
                <span className="stat-label"><TicketCheck size={14} aria-hidden="true" /> Redeemed by users</span>
              </motion.div>
            </>
          )}
        </div>
      ) : isLoading ? (
        <div className="state-box"><div className="loading-spinner" /><p className="state">Checking your license…</p></div>
      ) : error ? (
        <div className="state-box error">
          <ShieldAlert />
          <p className="state error">Could not load your license status.</p>
          <button className="secondary-button" onClick={() => void refetch()}><RotateCcw size={14} /> Retry</button>
        </div>
      ) : activeKey ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <LicenseTicket
            license={activeKey}
            now={now}
            overline="ACTIVE LICENSE"
            action={<Link className="ticket-action" to="/keys">Manage key <ArrowRight size={14} aria-hidden="true" /></Link>}
          />
        </motion.div>
      ) : (
        <motion.section
          className="license-card no-license"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <div className="license-main">
            <p className="overline">NO ACTIVE LICENSE</p>
            <h2>Redeem a key to start using scripts</h2>
            <p className="muted">Keys are issued by Banana Hub developers and official vendors.</p>
          </div>
          <Link className="primary-button" to="/redeem">
            Redeem a key
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </motion.section>
      )}

      <section className="loaders-section">
        <div className="section-head">
          <span className="section-icon" aria-hidden="true"><TerminalSquare size={17} /></span>
          <div className="section-head-text">
            <h2>Script Loaders</h2>
            <p className="muted section-hint">Copy a loadstring and run it in your Roblox executor.</p>
          </div>
        </div>
        <div className="loaders-grid">
          {LOADERS.map((loader, index) => <LoaderCard key={loader.tier} loader={loader} index={index} />)}
        </div>
      </section>

      <section className="games-section">
        <div className="games-toolbar">
          <div className="games-toolbar-heading">
            <span className="section-icon" aria-hidden="true"><Gamepad2 size={17} /></span>
            <h2>Supported Games</h2>
            <span className="games-count-badge">{SUPPORTED_GAMES.length} games</span>
          </div>
        </div>

        <motion.div layout className="games-grid">
          <AnimatePresence mode="popLayout">
            {SUPPORTED_GAMES.map((game, index) => (
              <motion.a
                layout
                className="game-card"
                key={game.id}
                href={game.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${game.name} on Roblox`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(index, 8) * 0.05 } }}
                transition={spring}
                exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
              >
                <div className="game-icon-box">
                  <img src={game.icon} alt="" aria-hidden="true" loading="lazy" width={64} height={64} />
                </div>
                <div className="game-card-body">
                  <div className="game-card-head">
                    <h3 className="game-card-title">{game.name}</h3>
                    <ArrowUpRight className="game-card-link-icon" aria-hidden="true" />
                  </div>
                  <span className="game-card-genre">{game.genre}</span>
                  <p className="game-card-desc">{game.description}</p>
                  <div className="game-tiers">
                    {game.tiers.map(tier => (
                      <span key={tier} className={`tier-badge tier-${tier}`}>
                        {tier === 'premium' && <Crown className="tier-icon" aria-hidden="true" />}
                        {tier === 'premium' ? 'PREMIUM' : 'FREE'}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.a>
            ))}
          </AnimatePresence>
        </motion.div>
      </section>
    </>
  )
}

function Keys({ profile }: { profile: Profile | null }) {
  return (
    <>
      <PageTitle
        kicker="KEYS & DEVICES"
        title="Key Management"
        detail="Expiry dates, device links, and hardware resets for every key you hold."
      />
      <section className="data-section">
        <KeyRows profile={profile} />
      </section>
    </>
  )
}

function Redeem({ profile }: { profile: Profile }) {
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')
  const [redeemed, setRedeemed] = useState('')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const { data: keys, isLoading } = useKeys(profile)
  const now = useNow()
  const activeKey = keys?.find(isKeyActive) ?? null
  const locked = Boolean(activeKey) && !redeemed

  async function redeem(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    setRedeemed('')
    const clean = value.trim().toUpperCase()
    try {
      const { data, error } = await supabase!.rpc('redeem_key', { p_key: clean })
      if (error) {
        setMessage(
          error.message.includes('404') || error.code === 'PGRST202'
            ? 'Redeem service is not installed yet. Ask the administrator to apply the latest database migration.'
            : error.message.includes('invalid_key')
            ? 'This key is incomplete or malformed. Paste the full key exactly as issued.'
            : error.message.includes('key_unavailable')
            ? 'This key is invalid, expired, revoked, or already redeemed.'
            : error.message.includes('redeem_limit_reached')
            ? 'You already have an active key. Wait for it to expire before redeeming a new one.'
            : error.message.includes('not_authorized')
            ? 'This action requires a User account.'
            : 'Could not redeem key. Please retry.'
        )
      } else {
        const result = data as { id?: string; duration?: string; expires_at?: string | null } | null
        if (result?.id) localStorage.setItem(`banana-redeemed-key:${result.id}`, clean)
        setRedeemed(clean)
        setMessage(`Key redeemed successfully. Duration: ${result?.duration ?? 'unknown'}.`)
        setValue('')
        await queryClient.invalidateQueries({ queryKey: ['keys', profile.role] })
      }
    } catch {
      setMessage('Could not reach the redeem service. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <div className="state-box">
        <div className="loading-spinner" />
        <p className="state">Checking redemption status…</p>
      </div>
    )
  }

  return (
    <>
      <PageTitle kicker="REDEMPTION" title="Redeem Access Key" detail="Enter a key provided by a developer or official vendor." />

      {locked && activeKey ? (
        <motion.div
          className="redeem-locked"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <LicenseTicket
            license={activeKey}
            now={now}
            overline="ACTIVE KEY IN USE"
            action={<Link className="ticket-action" to="/keys">Manage this key <ArrowRight size={14} aria-hidden="true" /></Link>}
          />
          <p className="muted locked-note">One active key per account. You can redeem a new key after this one expires.</p>
        </motion.div>
      ) : (
        <motion.form
          className="action-form"
          onSubmit={redeem}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <label htmlFor="redeem-key">Access Key</label>
          <input
            id="redeem-key"
            required
            autoComplete="off"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Paste your key (e.g. BH-XXXX-XXXX)"
          />

          <AnimatePresence>
            {message && (
              <motion.p
                role="status"
                className={`state inline ${message.includes('successfully') ? 'success' : 'error'}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {message}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {redeemed && (
              <motion.div
                className="generated"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                style={{ overflow: 'hidden' }}
              >
                <label htmlFor="redeemed-key">Your Active Key</label>
                <input id="redeemed-key" readOnly value={redeemed} />
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void copyText(redeemed).then(ok => setMessage(ok ? 'Key copied to clipboard.' : 'Copy failed. Your browser blocked clipboard access.'))}
                  >
                    <Copy size={14} />
                    Copy Key
                  </button>
                  <Link className="primary-button" to="/keys">Go to Key Manage</Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="primary-button"
            disabled={busy}
          >
            {busy ? 'Verifying & Redeeming…' : 'Redeem Key'}
          </motion.button>
        </motion.form>
      )}

      <p className="redeem-alt muted">Looking to buy? <Link className="inline-link" to="/pricing">See pricing</Link>.</p>
    </>
  )
}

const KEY_DURATIONS = [
  { value: '48h', label: '48 Hours / 2 Days', detail: 'Valid 48 hours from issue' },
  { value: '7d', label: '7 Days', detail: 'Valid 7 days from issue' },
  { value: '30d', label: '30 Days', detail: 'Valid 30 days from issue' },
  { value: 'lifetime', label: 'Lifetime', detail: 'Never expires' },
] as const

const KEY_PRICES: Record<string, number> = { '48h': 5000, '7d': 15000, '30d': 30000, lifetime: 50000 }
function formatPrice(value: number) {
  return `Rp ${new Intl.NumberFormat('id-ID').format(value)}`
}

function LicenseTicket({ license, now, overline, action }: { license: KeyRow; now: number; overline: string; action: ReactNode }) {
  const lifetime = license.duration === 'lifetime' || !license.expires_at
  const remaining = !lifetime && license.expires_at ? formatRemaining(license.expires_at, now) : null
  const urgent = Boolean(license.expires_at && new Date(license.expires_at).getTime() - now < 86400000 && new Date(license.expires_at).getTime() > now)
  return (
    <div className="license-ticket">
      <div className="ticket-body">
        <p className="ticket-overline">{overline}</p>
        <div className="ticket-key">
          <KeyRound size={18} aria-hidden="true" />
          <span className="key-code">{license.key_prefix}••••••••</span>
        </div>
        <div className="ticket-meta">
          <span><Clock size={14} aria-hidden="true" /> {formatDuration(license.duration)}</span>
          {remaining
            ? <span className={urgent ? 'ticket-warn' : undefined}><Clock size={14} aria-hidden="true" /> {remaining}</span>
            : <span><ShieldCheck size={14} aria-hidden="true" /> Never expires</span>}
          {!lifetime && license.expires_at && <span><CalendarDays size={14} aria-hidden="true" /> {formatDate(license.expires_at)}</span>}
          <DeviceBadge bound={Boolean(license.device_bound_at)} />
        </div>
      </div>
      <div className="ticket-stub">
        {lifetime ? <Crown size={22} aria-hidden="true" /> : <TicketCheck size={22} aria-hidden="true" />}
        <span className="ticket-tier">{lifetime ? 'Lifetime' : formatDuration(license.duration)}</span>
        {action}
      </div>
    </div>
  )
}

function Pricing({ profile }: { profile: Profile | null }) {
  return (
    <>
      <PageTitle kicker="PRICING" title="Key Pricing" detail="One active key per account. All prices in Indonesian Rupiah." />

      <div className="price-list">
        {KEY_DURATIONS.map(option => {
          const price = KEY_PRICES[option.value]
          const days = option.value === '48h' ? 2 : option.value === '7d' ? 7 : option.value === '30d' ? 30 : 0
          return (
            <div className="price-row" key={option.value}>
              <div className="price-row-info">
                <span className="price-name">
                  {option.label}
                  {option.value === 'lifetime' && <Crown size={15} className="price-crown" aria-hidden="true" />}
                </span>
                <span className="price-note muted">
                  {days ? `${formatPrice(Math.round(price / days))} per day` : 'One-time payment, never expires'}
                </span>
              </div>
              <span className={`price-value ${option.value === 'lifetime' ? 'lifetime' : ''}`}>{formatPrice(price)}</span>
            </div>
          )
        })}
      </div>

      <section className="buy-block">
        <h2>Want to buy?</h2>
        <p className="muted">Keys are issued directly on Discord. Message @aerizuu to purchase, then redeem your key here.</p>
        <div className="button-row">
          <a
            className="secondary-button discord-btn"
            href="https://discord.com/users/975269168184168539"
            target="_blank"
            rel="noreferrer"
          >
            <DiscordIcon />
            Message @aerizuu
          </a>
          <a
            className="secondary-button discord-btn"
            href="https://discord.gg/WHevndyM2"
            target="_blank"
            rel="noreferrer"
          >
            <DiscordIcon />
            Join Banana Hub server
          </a>
          {profile?.role === 'user' ? (
            <Link className="secondary-button" to="/redeem"><TicketCheck size={15} /> Redeem a key</Link>
          ) : (
            <Link className="secondary-button" to="/get-key"><KeyRound size={15} /> Issue a key</Link>
          )}
        </div>
      </section>
    </>
  )
}

function GetKey() {
  const [duration, setDuration] = useState<typeof KEY_DURATIONS[number]['value']>('48h')
  const [result, setResult] = useState('')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function generate() {
    setBusy(true)
    setResult('')
    setMessage('')
    setCopied(false)
    const { data, error } = await supabase!.rpc('generate_key', { p_duration: duration })
    if (error || !data || typeof data !== 'object' || !('key' in data)) {
      setMessage('Key generation failed. Please try again.')
    } else {
      setResult(String(data.key))
    }
    setBusy(false)
  }

  async function copyResult() {
    const ok = await copyText(result)
    setCopied(ok)
    if (!ok) setMessage('Copy failed. Select the key text and copy it manually.')
    else setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <PageTitle kicker="KEY ISSUANCE" title="Issue Key" detail="Generate an access key. It locks to the first device that uses it." />
      <motion.section
        className="action-form"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <fieldset className="duration-field">
          <legend>Key Duration</legend>
          <div className="duration-grid">
            {KEY_DURATIONS.map(option => (
              <label key={option.value} className={`duration-option ${duration === option.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="duration"
                  value={option.value}
                  checked={duration === option.value}
                  onChange={() => setDuration(option.value)}
                />
                {duration === option.value && (
                  <motion.span layoutId="duration-check" className="duration-check" transition={spring} aria-hidden="true">
                    <CheckCircle2 size={15} />
                  </motion.span>
                )}
                <span className="duration-label">{option.label}</span>
                <span className="duration-detail">{option.detail}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="primary-button"
          onClick={() => void generate()}
          disabled={busy}
        >
          <KeyRound size={16} />
          {busy ? 'Generating…' : 'Generate Key'}
        </motion.button>

        <AnimatePresence>
          {message && (
            <motion.p role="alert" className="form-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {message}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {result && (
            <motion.div
              className="generated"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              style={{ overflow: 'hidden' }}
            >
              <label htmlFor="generated-key">New key generated. Save it now, it is only shown once.</label>
              <input id="generated-key" readOnly value={result} />
              <div className="button-row">
                <motion.button whileTap={{ scale: 0.97 }} className="secondary-button" onClick={() => void copyResult()}>
                  {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy Key'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </>
  )
}

function SettingsPage({ profile, theme, setTheme }: { profile: Profile | null; theme: Theme; setTheme: (value: Theme) => void }) {
  return (
    <>
      <PageTitle kicker="PREFERENCES" title="Settings" detail="Account details, session configuration, and theme settings." />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <section className="settings-block">
          <h2>Appearance</h2>
          <p className="muted">Choose your preferred workspace theme. It syncs to your profile.</p>
          <div className="theme-options">
            {(['dark', 'light'] as const).map(item => (
              <motion.button
                key={item}
                whileTap={{ scale: 0.97 }}
                className={`theme-option ${theme === item ? 'selected' : ''}`}
                onClick={() => setTheme(item)}
                aria-pressed={theme === item}
              >
                {theme === item && <motion.span layoutId="theme-ring" className="theme-ring" transition={spring} aria-hidden="true" />}
                {item === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                {item === 'dark' ? 'Dark' : 'Light'}
              </motion.button>
            ))}
          </div>
        </section>

        <section className="settings-block">
          <h2>Account Details</h2>
          <dl className="account-list">
            <div><dt>Username</dt><dd>{profile?.username ?? 'Unavailable'}</dd></div>
            <div><dt>Role</dt><dd className="capitalize">{profile?.role ?? 'Unavailable'}</dd></div>
            <div><dt>Discord ID</dt><dd>{profile?.discord_id ?? 'Not linked'}</dd></div>
          </dl>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="secondary-button"
            onClick={() => void supabase!.auth.signOut()}
          >
            <LogOut size={16} />
            Sign out
          </motion.button>
        </section>
      </motion.div>
    </>
  )
}

function AdminSettings() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-allowlist'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase!.rpc('get_discord_admin_allowlist')
      if (error) throw error
      return (data as { discord_id: string }[]).map(row => row.discord_id)
    },
  })
  return (
    <>
      <PageTitle kicker="ACCESS CONTROL" title="Admin configuration" detail="Admin IDs are configured privately in Supabase, never in browser environment variables." />
      <section className="settings-block">
        <h2>Discord admin IDs</h2>
        {isLoading ? (
          <div className="state-box"><div className="loading-spinner" /><p className="state">Loading admin list…</p></div>
        ) : error ? (
          <div className="state-box error">
            <ShieldAlert />
            <p className="state error">Could not load the admin list.</p>
            <button className="secondary-button" onClick={() => void refetch()}><RotateCcw size={14} /> Retry</button>
          </div>
        ) : data?.length ? (
          <ul className="admin-list">
            {data.map((id, index) => (
              <motion.li key={id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(index, 8) * 0.04 } }}>
                <ShieldCheck size={14} aria-hidden="true" />
                <code>{id}</code>
              </motion.li>
            ))}
          </ul>
        ) : (
          <p className="state">No admin IDs configured yet. Add the first one through the Supabase SQL Editor.</p>
        )}
        <p className="muted">Manage IDs using Supabase SQL Editor. Changes apply at next Discord sign-in.</p>
      </section>
    </>
  )
}
