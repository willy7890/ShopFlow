import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import { Login, Register, Forgot, Reset } from '@/features/auth/AuthPages'
import Onboarding from '@/features/auth/Onboarding'
import { Skeleton } from '@/components/ui'

const L = (f: () => Promise<{ default: React.ComponentType }>) => { const C = lazy(f); return <Suspense fallback={<Skeleton h={240} />}><C /></Suspense> }
const router = createBrowserRouter([
  { path: '/login', element: <Login /> }, { path: '/register', element: <Register /> }, { path: '/forgot', element: <Forgot /> }, { path: '/reset', element: <Reset /> },
  { path: '/onboarding', element: <Onboarding /> },
  {
    path: '/', element: <AppShell />, errorElement: <p className="p-6 text-er">Something went wrong. Please reload.</p>,
    children: [
      { index: true, element: L(() => import('@/features/dashboard/Dashboard')) },
      { path: 'pos', element: L(() => import('@/features/pos/PosPage')) },
      { path: 'products', element: L(() => import('@/features/catalog/Products')) },
      { path: 'categories', element: L(() => import('@/features/catalog/Categories')) },
      { path: 'inventory', element: L(() => import('@/features/inventory/Inventory')) },
      { path: 'purchases', element: L(() => import('@/features/people/Purchases')) },
      { path: 'sales', element: L(() => import('@/features/sales/Sales')) },
      { path: 'orders', element: L(() => import('@/features/orders/Orders')) },
      { path: 'invoices', element: L(() => import('@/features/sales/Invoices')) },
      { path: 'customers', element: L(() => import('@/features/people/Customers')) },
      { path: 'suppliers', element: L(() => import('@/features/people/Suppliers')) },
      { path: 'debts', element: L(() => import('@/features/people/Debts')) },
      { path: 'expenses', element: L(() => import('@/features/finance/Expenses')) },
      { path: 'cashbook', element: L(() => import('@/features/finance/Cashbook')) },
      { path: 'reports', element: L(() => import('@/features/finance/Reports')) },
      { path: 'ai', element: L(() => import('@/features/ai/Assistant')) },
      { path: 'employees', element: L(() => import('@/features/admin/Employees')) },
      { path: 'stores', element: L(() => import('@/features/admin/Stores')) },
      { path: 'subscription', element: L(() => import('@/features/admin/Subscription')) },
      { path: 'platform-admin', element: L(() => import('@/features/admin/PlatformAdmin')) },
      { path: 'settings', element: L(() => import('@/features/admin/Settings')) },
      { path: 'sync', element: L(() => import('@/features/admin/SyncPage')) },
    ],
  },
])
export default function App() { return <RouterProvider router={router} /> }
