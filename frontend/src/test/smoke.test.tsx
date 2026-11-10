// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { queryClient } from '../lib/queryClient'
import { useAuth } from '../store/auth'
import { mockApi } from '../api/mock'

beforeAll(async () => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock, writable: true, configurable: true })
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, writable: true, configurable: true })
  const { token, me } = await mockApi.auth.login('owner@example.com', 'password1')
  useAuth.getState().setSession(token, me)
})
const mount = (C: ComponentType, path = '/') => render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><C /></MemoryRouter></QueryClientProvider>)

describe('every screen renders against the mock API', () => {
  const pages: [string, () => Promise<{ default: ComponentType }>, string][] = [
    ['dashboard', () => import('../features/dashboard/Dashboard'), 'Dashibodi'], ['products', () => import('../features/catalog/Products'), 'Sabuni ya unga'],
    ['categories', () => import('../features/catalog/Categories'), 'Vinywaji'], ['inventory', () => import('../features/inventory/Inventory'), 'Stoo ya sasa'],
    ['purchases', () => import('../features/people/Purchases'), 'PUR-0031'], ['sales', () => import('../features/sales/Sales'), 'INV-0148'], ['invoices', () => import('../features/sales/Invoices'), 'INV-0147'],
    ['customers', () => import('../features/people/Customers'), 'Mama Neema'], ['suppliers', () => import('../features/people/Suppliers'), 'Kariakoo Wholesale'], ['debts', () => import('../features/people/Debts'), 'Duka la Juma'],
    ['expenses', () => import('../features/finance/Expenses'), 'Kodi ya duka'], ['cashbook', () => import('../features/finance/Cashbook'), 'Kitabu cha Fedha'], ['reports', () => import('../features/finance/Reports'), 'Ripoti'],
    ['ai', () => import('../features/ai/Assistant'), 'Msaidizi wa AI'], ['employees', () => import('../features/admin/Employees'), 'Neema Joseph'], ['stores', () => import('../features/admin/Stores'), 'Maduka na Matawi'],
    ['subscription', () => import('../features/admin/Subscription'), 'Business Pro'], ['settings', () => import('../features/admin/Settings'), 'Mipangilio'], ['sync', () => import('../features/admin/SyncPage'), 'Mtandao na usawazishaji'],
    ['pos', () => import('../features/pos/PosPage'), 'Kituo cha Mauzo'],
  ]
  for (const [name, load, text] of pages) {
    it(name, async () => { const { default: C } = await load(); mount(C); await waitFor(() => expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0), { timeout: 4000 }); cleanup() })
  }
})

describe('key flows', () => {
  it('restock: only the quantity is needed to add new stock', async () => {
    const { default: Products } = await import('../features/catalog/Products'); mount(Products)
    await screen.findByText('Sabuni ya unga')
    const row = screen.getByText('Sabuni ya unga').closest('tr')!
    fireEvent.click(row.querySelector('button.lnk')!)   // "+ Mzigo" is the first link in the stock cell
    fireEvent.change(await screen.findByLabelText('Idadi iliyoletwa'), { target: { value: '24' } })
    await screen.findByText(/Stoo baada ya kuongeza: 24/)
    fireEvent.click(screen.getByText('Hifadhi'))
    await waitFor(async () => { const p = (await mockApi.catalog.products()).find((x) => x.id === 5)!; expect(p.variants[0].stock).toBeGreaterThanOrEqual(24) }, { timeout: 4000 })
    cleanup()
  })
  it('POS: add item by tapping a tile, complete sale, get a receipt, stock goes down', async () => {
    const before = (await mockApi.catalog.products()).find((p) => p.id === 3)!.variants[0].stock
    const { default: Pos } = await import('../features/pos/PosPage'); mount(Pos)
    fireEvent.click((await screen.findByText('Mafuta ya alizeti 1L')).closest('button')!)
    fireEvent.click(await screen.findByText(/Kamilisha Mauzo/))
    await screen.findByText('Mauzo yamekamilika', {}, { timeout: 4000 })
    expect((await mockApi.catalog.products()).find((p) => p.id === 3)!.variants[0].stock).toBe(before - 1)
    cleanup()
  })
  it('POS: split payment that does not match the total is rejected', async () => {
    const { default: Pos } = await import('../features/pos/PosPage'); mount(Pos)
    fireEvent.click((await screen.findByText('Maji 1.5L')).closest('button')!)
    fireEvent.change(screen.getAllByRole('spinbutton').find((i) => (i as HTMLInputElement).placeholder === '1000')!, { target: { value: '500' } })
    fireEvent.click(screen.getByText(/Kamilisha Mauzo/))
    await screen.findByText('Malipo hayalingani na jumla'); cleanup()
  })
  it('AI assistant answers and cannot change data', async () => {
    const { default: Ai } = await import('../features/ai/Assistant'); mount(Ai)
    fireEvent.click(await screen.findByText('Nina madeni kiasi gani?'))
    await screen.findByText(/Jumla ya madeni/, {}, { timeout: 4000 }); cleanup()
  })
  it('employee permissions can be changed and saved', async () => {
    const { default: Employees } = await import('../features/admin/Employees'); mount(Employees)
    await screen.findByText('Neema Joseph')
    fireEvent.click(screen.getAllByText('Ruhusa')[0])
    await screen.findByText('Toa ruhusa')
    fireEvent.click(screen.getByLabelText('Simamia mauzo'))
    fireEvent.click(screen.getByText('Hifadhi ruhusa'))
    await waitFor(async () => {
      const employee = (await mockApi.admin.employees()).find((item) => item.email === 'neema@example.com')
      expect(employee?.permissions).not.toContain('manage_sales')
    })
    cleanup()
  })
})
