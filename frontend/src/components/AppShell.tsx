import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, Package, Tags, Boxes, Truck, Receipt, FileText, Users, Store, Wallet, HandCoins, BookOpen, BarChart3, Sparkles, UserCog, Building2, CreditCard, Settings, Menu, Sun, Moon, LogOut, Wifi, WifiOff, PanelLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useOffline, useSync } from '@/offline/sync'
import { Toast } from './ui'

interface Item { id: string; path: string; icon: LucideIcon; perm: string; feature?: string; inventoryOnly?: boolean }
export const NAV: Item[] = [
  { id: 'dash', path: '/', icon: LayoutDashboard, perm: 'dash' },
  { id: 'pos', path: '/pos', icon: ShoppingCart, perm: 'pos' },
  { id: 'products', path: '/products', icon: Package, perm: 'catalog', feature: 'inventory', inventoryOnly: true },
  { id: 'categories', path: '/categories', icon: Tags, perm: 'catalog', feature: 'inventory', inventoryOnly: true },
  { id: 'inventory', path: '/inventory', icon: Boxes, perm: 'inventory', feature: 'inventory', inventoryOnly: true },
  { id: 'purchases', path: '/purchases', icon: Truck, perm: 'purchases', feature: 'inventory', inventoryOnly: true },
  { id: 'sales', path: '/sales', icon: Receipt, perm: 'sales' },
  { id: 'invoices', path: '/invoices', icon: FileText, perm: 'sales' },
  { id: 'customers', path: '/customers', icon: Users, perm: 'customers' },
  { id: 'suppliers', path: '/suppliers', icon: Store, perm: 'purchases' },
  { id: 'expenses', path: '/expenses', icon: Wallet, perm: 'finance' },
  { id: 'debts', path: '/debts', icon: HandCoins, perm: 'customers' },
  { id: 'cashbook', path: '/cashbook', icon: BookOpen, perm: 'finance' },
  { id: 'reports', path: '/reports', icon: BarChart3, perm: 'reports' },
  { id: 'ai', path: '/ai', icon: Sparkles, perm: 'ai', feature: 'ai' },
  { id: 'employees', path: '/employees', icon: UserCog, perm: 'employees' },
  { id: 'stores', path: '/stores', icon: Building2, perm: 'stores', feature: 'multistore' },
  { id: 'subscription', path: '/subscription', icon: CreditCard, perm: 'subscription' },
  { id: 'settings', path: '/settings', icon: Settings, perm: 'settings' },
]
/** Visibility rules: backend permissions + backend entitlements + operating mode. (The API enforces the same rules.) */
export function useVisibleNav() {
  const { me, can, feature } = useAuth()
  const quick = me?.business?.mode === 'quick'
  return NAV.filter((n) => can(n.perm) && !(quick && n.inventoryOnly) && (!n.feature || feature(n.feature)))
}
export const useRouteAllowed = (path: string) => useVisibleNav().some((n) => (n.path === '/' ? path === '/' : path.startsWith(n.path))) || ['/sync'].includes(path)

export default function AppShell() {
  const { me, token, logout, storeId, setStore } = useAuth()
  const { t, lang } = useT()
  const ui = useUi()
  const nav = useVisibleNav()
  const loc = useLocation()
  const offline = useOffline()
  const pending = useSync((s) => s.items.filter((i) => i.state !== 'synced').length)
  const syncing = useSync((s) => s.syncing)
  if (!token || !me) return <Navigate to="/login" replace />
  if (!me.business) return <Navigate to="/onboarding" replace />
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
          <b className="truncate max-w-[180px]">{me.business.name}</b>
          <select aria-label={t('store')} className="inp !w-auto !min-h-[38px] !py-1" value={storeId} onChange={(e) => setStore(e.target.value)}>
            <option value="all">{t('allst')}</option>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
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
          {allowed ? <Outlet /> : <div><h1 className="text-2xl font-bold mb-2">{t('forbid')}</h1><p className="text-mu">{t('sb_lock')}</p></div>}
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
