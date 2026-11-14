import { useEffect, useState } from 'react'
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, Package, Tags, Boxes, Truck, Receipt, FileText, Users, Store, Wallet, HandCoins, BookOpen, BarChart3, Sparkles, UserCog, Building2, CreditCard, Settings, Menu, Sun, Moon, LogOut, Wifi, WifiOff, PanelLeft, ShieldCheck, ClipboardList } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/store/auth'
import { api } from '@/api'
import { useUi } from '@/store/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useOffline, useSync } from '@/offline/sync'
import { Toast } from './ui'

interface Item { id: string; path: string; icon: LucideIcon; perm: string; feature?: string; inventoryOnly?: boolean; superAdminOnly?: boolean }
export const NAV: Item[] = [
  { id: 'dash', path: '/', icon: LayoutDashboard, perm: 'dash' },
  { id: 'pos', path: '/pos', icon: ShoppingCart, perm: 'pos', feature: 'sales_pos' },
  { id: 'products', path: '/products', icon: Package, perm: 'catalog', feature: 'product_management', inventoryOnly: true },
  { id: 'categories', path: '/categories', icon: Tags, perm: 'catalog', feature: 'product_categories', inventoryOnly: true },
  { id: 'inventory', path: '/inventory', icon: Boxes, perm: 'inventory', feature: 'inventory', inventoryOnly: true },
  { id: 'purchases', path: '/purchases', icon: Truck, perm: 'purchases', feature: 'inventory', inventoryOnly: true },
  { id: 'sales', path: '/sales', icon: Receipt, perm: 'sales', feature: 'sales_pos' },
  { id: 'orders', path: '/orders', icon: ClipboardList, perm: 'sales', feature: 'sales_pos' },
  { id: 'invoices', path: '/invoices', icon: FileText, perm: 'sales', feature: 'invoices' },
  { id: 'customers', path: '/customers', icon: Users, perm: 'customers', feature: 'customers' },
  { id: 'suppliers', path: '/suppliers', icon: Store, perm: 'purchases', feature: 'supplier_management' },
  { id: 'expenses', path: '/expenses', icon: Wallet, perm: 'finance', feature: 'cashbook' },
  { id: 'debts', path: '/debts', icon: HandCoins, perm: 'customers', feature: 'customer_debtors' },
  { id: 'cashbook', path: '/cashbook', icon: BookOpen, perm: 'finance', feature: 'cashbook' },
  { id: 'reports', path: '/reports', icon: BarChart3, perm: 'reports' },
  { id: 'ai', path: '/ai', icon: Sparkles, perm: 'ai', feature: 'advanced_analytics' },
  { id: 'employees', path: '/employees', icon: UserCog, perm: 'employees', feature: 'employee_management' },
  { id: 'stores', path: '/stores', icon: Building2, perm: 'stores', feature: 'multi_store' },
  { id: 'subscription', path: '/subscription', icon: CreditCard, perm: 'subscription' },
  { id: 'settings', path: '/settings', icon: Settings, perm: 'settings' },
  { id: 'platformAdmin', path: '/platform-admin', icon: ShieldCheck, perm: '', superAdminOnly: true },
]
/** Visibility rules: backend permissions + backend entitlements + operating mode. (The API enforces the same rules.) */
export function useVisibleNav() {
  const { me, can, feature } = useAuth()
  if (me?.user.isSuperAdmin) return NAV
  const quick = me?.business?.mode === 'quick'
  return NAV.filter((n) => n.superAdminOnly
    ? !!me?.user.isSuperAdmin
    : can(n.perm) && !(quick && n.inventoryOnly) && (!n.feature || feature(n.feature)))
}
export const useRouteAllowed = (path: string) => useVisibleNav().some((n) => (n.path === '/' ? path === '/' : path.startsWith(n.path))) || ['/sync'].includes(path)

export default function AppShell() {
  const { me, token, logout, storeId, setStore, setMe } = useAuth()
  const [profileError, setProfileError] = useState('')
  const [adminBusinesses, setAdminBusinesses] = useState<{ id: string; name: string }[]>([])
  const { t, lang } = useT()
  const ui = useUi()
  const nav = useVisibleNav()
  const loc = useLocation()
  const isSuperAdmin = me?.user.isSuperAdmin ?? false
  const offline = useOffline()
  const pending = useSync((s) => s.items.filter((i) => i.state !== 'synced').length)
  const syncing = useSync((s) => s.syncing)
  useEffect(() => {
    let active = true
    if (token) {
      void api.auth.me().then((profile) => {
        if (active) {
          setMe(profile)
          setProfileError('')
        }
      }).catch((reason: unknown) => {
        if (active) setProfileError(reason instanceof Error ? reason.message : String(reason))
      })
    }
    return () => { active = false }
  }, [setMe, token])
  useEffect(() => {
    let active = true
    if (token && isSuperAdmin) {
      void api.business.access().then((items) => { if (active) setAdminBusinesses(items) })
        .catch((reason: unknown) => { if (active) setProfileError(reason instanceof Error ? reason.message : String(reason)) })
    }
    return () => { active = false }
  }, [isSuperAdmin, token])
  useEffect(() => {
    if (me && storeId !== 'all' && !me.stores.some((store) => store.id === storeId)) {
      setStore('all')
    }
  }, [me, setStore, storeId])
  if (!token || !me) return <Navigate to="/login" replace />
  if (!me.business && !isSuperAdmin) return <Navigate to="/onboarding" replace />
  if (isSuperAdmin && loc.pathname === '/') return <Navigate to="/platform-admin" replace />
  const dark = ui.theme === 'dark' || (ui.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const names = t('nav') as Record<string, string>
  const allowed = nav.some((n) => (n.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.path))) || loc.pathname.startsWith('/sync')
  const mobile = ['dash', 'pos', 'sales', 'ai', 'settings'].map((id) => nav.find((n) => n.id === id)).filter(Boolean) as Item[]
  return (
    <div className={cn('grid min-h-screen', ui.collapsed ? 'md:grid-cols-[68px_1fr]' : 'md:grid-cols-[232px_1fr]')}>
      <nav aria-label="Menu" className={cn('bg-sf border-r border-bd p-2.5 flex flex-col gap-0.5 md:sticky md:top-0 md:h-screen overflow-auto z-20', 'fixed inset-y-0 left-0 w-64 md:static md:w-auto transition-transform', ui.menuOpen ? 'translate-x-0 shadow-[0_0_0_100vmax_rgba(0,0,0,.45)]' : '-translate-x-full md:translate-x-0')}>
        <div className="flex items-center gap-2 px-2 py-2 mb-2 font-extrabold text-lg"><span className="w-8 h-8 rounded-lg bg-ac text-on grid place-items-center">S</span>{!ui.collapsed && 'ShopFlow'}</div>
        {nav.map((n) => (
          <NavLink key={n.id} to={n.path} end={n.path === '/'} onClick={() => ui.setMenu(false)}
            className={({ isActive }) => cn('flex items-center gap-3 px-2.5 min-h-[40px] rounded-lg text-sm font-semibold', isActive ? 'bg-ac/15 text-tx' : 'text-mu hover:text-tx')}>
            <n.icon size={18} />{!ui.collapsed && <span>{names[n.id]}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 bg-sf border-b border-bd px-3 md:px-5 py-2 flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost md:hidden !min-h-[38px] !px-2" aria-label="Menu" onClick={() => ui.setMenu(!ui.menuOpen)}><Menu size={18} /></button>
          <button className="btn btn-ghost hidden md:inline-flex !min-h-[38px] !px-2" aria-label="Collapse" onClick={ui.toggleCollapsed}><PanelLeft size={18} /></button>
          <b className="truncate max-w-[180px]">{me.business?.name ?? t('platformAdmin')}</b>
          {isSuperAdmin && me.business && <span className="text-xs text-mu">Super Admin business access</span>}
          {isSuperAdmin && adminBusinesses.length > 0 && (
            <select
              aria-label="Business context"
              className="inp !w-auto !min-h-[38px] !py-1"
              value={me.business?.id ?? ''}
              onChange={(event) => {
                const id = event.target.value
                void api.auth.me(id).then(setMe).catch((reason: unknown) => {
                  setProfileError(reason instanceof Error ? reason.message : String(reason))
                })
              }}
            >
              <option value="">Platform administration</option>
              {adminBusinesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          )}
          {me.business ? (
            <select
              aria-label={t('store')}
              className="inp !w-auto !min-h-[38px] !py-1"
              value={me.stores.some((store) => store.id === storeId) || storeId === 'all' ? storeId : 'all'}
              onChange={(e) => setStore(e.target.value)}
            >
              <option value="all">{t('allst')}</option>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : null}
          <span className="flex-1" />
          <NavLink to="/sync" className={cn('rounded-full border px-3 min-h-[36px] inline-flex items-center gap-1.5 text-sm font-semibold', offline ? 'border-er text-er' : 'border-bd text-ok')}>
            {offline ? <WifiOff size={15} /> : <Wifi size={15} />}{syncing ? t('o_sync') : t(offline ? 'o_off' : 'o_on')}{pending > 0 && ` · ${pending}`}
          </NavLink>
          <div className="inline-flex border border-bd rounded-lg overflow-hidden">
            {(['sw', 'en'] as const).map((l) => <button key={l} aria-pressed={lang === l} onClick={() => ui.setLang(l)} className={cn('px-2.5 min-h-[36px] text-sm font-semibold', lang === l ? 'bg-ac text-on' : 'bg-sf text-mu')}>{l.toUpperCase()}</button>)}
          </div>
          <button className="btn btn-ghost !min-h-[36px] !px-2" aria-label={t('theme')} onClick={() => ui.setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="btn btn-ghost !min-h-[36px] !px-2" aria-label={t('logout')} onClick={logout}><LogOut size={16} /></button>
        </header>
        <main className="p-4 md:p-6 pb-24 md:pb-6 max-w-[1200px]">
          {profileError && <p role="alert" className="text-er text-sm mb-3">{profileError}</p>}
          {allowed ? isSuperAdmin && !me.business && loc.pathname !== '/platform-admin' ? (
            <section className="rounded-xl border border-bd bg-sf p-6" aria-labelledby="admin-business-context-title">
              <h1 id="admin-business-context-title" className="text-2xl font-bold mb-2">Choose a business to inspect</h1>
              {adminBusinesses.length ? <p className="text-mu">Select a business from the Business context menu above to open this module with platform-admin access.</p> : <p className="text-mu">No businesses are available yet. You can manage the platform from Platform Administration.</p>}
            </section>
          ) : <Outlet /> : <section role="alert" className="rounded-xl border border-er p-6"><h1 className="text-2xl font-bold mb-2">Unauthorized</h1><p className="text-mu">{t('sb_lock')}</p></section>}
        </main>
      </div>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-sf border-t border-bd flex z-10" style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
        {mobile.map((n) => (
          <NavLink key={n.id} to={n.path} end={n.path === '/'} className={({ isActive }) => cn('flex-1 flex flex-col items-center py-2 text-[11px] font-semibold min-h-[52px]', isActive ? 'text-ac' : 'text-mu')}><n.icon size={18} />{names[n.id]}</NavLink>
        ))}
      </nav>
      <Toast />
    </div>
  )
}
