import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Order, OrderStatus } from '@/api/types'
import { useAuth } from '@/store/auth'
import { Field, Panel, QueryState, SelectField, Table, useNotify } from '@/components/ui'

const statuses: (OrderStatus | '')[] = ['', 'draft', 'confirmed', 'preparing', 'ready', 'fulfilled', 'converted', 'cancelled']
const currencyFormat = (value: string, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0))

export default function Orders() {
  const me = useAuth((state) => state.me)
  const { storeId } = useAuth()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [storeFilter, setStoreFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [store, setStore] = useState('')
  const [variantId, setVariantId] = useState(0)
  const [quantity, setQuantity] = useState('1')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [note, setNote] = useState('')
  const [actionError, setActionError] = useState('')
  const businessId = me?.business?.id
  const currency = me?.business?.currency ?? 'TZS'
  const orders = useQuery({
    queryKey: ['orders', businessId, search, status, storeFilter, offset],
    queryFn: () => api.orders.list({ search: search.trim() || undefined, status: status || undefined, storeId: storeFilter || undefined, offset, limit: 25 }),
    enabled: !!businessId,
  })
  const detail = useQuery({ queryKey: ['order', businessId, selectedId], queryFn: () => api.orders.get(selectedId), enabled: !!businessId && !!selectedId })
  const products = useQuery({ queryKey: ['orders', 'products', businessId], queryFn: api.catalog.products, enabled: !!businessId && showCreate })
  const availableVariants = useMemo(() => (products.data ?? []).flatMap((product) => product.variants.filter(() => !product.archived).map((variant) => ({ id: variant.id, name: `${product.name} · ${variant.label}`, price: variant.sell }))), [products.data])
  const storeIdForCreate = store || (me?.stores.some((item) => item.id === storeId) ? storeId : me?.stores[0]?.id) || ''
  const action = useMutation({
    mutationFn: (run: () => Promise<Order>) => run(),
    onSuccess: async (updated) => {
      setActionError('')
      setSelectedId(updated.id)
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['order', businessId, updated.id] })
      notify('Order updated successfully.')
    },
    onError: (error: Error) => setActionError(error.message),
  })
  const create = useMutation({
    mutationFn: () => {
      if (!storeIdForCreate) throw new Error('Select or create a store before creating an order.')
      if (!variantId || Number(quantity) <= 0) throw new Error('Choose an item and enter a quantity greater than zero.')
      return api.orders.create({ storeId: storeIdForCreate, customerName: customerName.trim() || undefined, customerPhone: customerPhone.trim() || undefined, note: note.trim() || undefined, items: [{ variantId, quantity: Number(quantity) }] })
    },
    onSuccess: async (created) => {
      setShowCreate(false); setCustomerName(''); setCustomerPhone(''); setNote(''); setActionError(''); setSelectedId(created.id)
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      notify('Order created successfully.')
    },
    onError: (error: Error) => setActionError(error.message),
  })

  if (!businessId) return <Panel title="Orders"><p className="text-mu">Choose a business to inspect its orders.</p></Panel>

  const can = (...roles: string[]) => !!me?.user.isSuperAdmin || roles.includes(me?.user.role ?? '')
  const run = (order: Order, operation: 'confirm' | 'prepare' | 'complete' | 'cancel' | 'convertToSale') => action.mutate(() => api.orders[operation](order.id))
  const orderActions = (order: Order) => <div className="flex flex-wrap gap-2">{
    order.status === 'draft' && can('owner', 'manager', 'storemgr', 'cashier', 'accountant', 'invmgr') && <button className="btn btn-ghost" disabled={action.isPending} onClick={() => run(order, 'confirm')}>Confirm</button>}
    {['draft', 'confirmed'].includes(order.status) && can('owner', 'manager', 'storemgr', 'invmgr') && <button className="btn btn-ghost" disabled={action.isPending} onClick={() => run(order, 'prepare')}>Prepare</button>}
    {['confirmed', 'preparing', 'ready'].includes(order.status) && can('owner', 'manager', 'storemgr') && <button className="btn btn-ghost" disabled={action.isPending} onClick={() => run(order, 'complete')}>Complete</button>}
    {!['converted', 'cancelled'].includes(order.status) && can('owner', 'manager', 'storemgr', 'cashier') && <button className="btn btn-ghost" disabled={action.isPending} onClick={() => run(order, 'cancel')}>Cancel</button>}
    {!['converted', 'cancelled'].includes(order.status) && can('owner', 'manager', 'storemgr', 'cashier', 'accountant') && <button className="btn" disabled={action.isPending} onClick={() => run(order, 'convertToSale')}>Convert to sale</button>}
  </div>

  return <div className="space-y-4">
    <Panel title="Orders">
      <div className="grid sm:grid-cols-5 gap-3 items-end">
        <Field label="Search order or customer" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} />
        <SelectField label="Status" value={status} onChange={(event) => { setStatus(event.target.value as OrderStatus | ''); setOffset(0) }}>{statuses.map((value) => <option key={value || 'all'} value={value}>{value ? value[0].toUpperCase() + value.slice(1) : 'All statuses'}</option>)}</SelectField>
        <SelectField label="Store" value={storeFilter} onChange={(event) => { setStoreFilter(event.target.value); setOffset(0) }}><option value="">All stores</option>{(me?.stores ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
        <div className="flex gap-2 mb-4"><button className="btn btn-ghost" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><button className="btn btn-ghost" disabled={(orders.data?.length ?? 0) < 25} onClick={() => setOffset(offset + 25)}>Next</button></div>
        <button className="btn mb-4" onClick={() => setShowCreate((value) => !value)}>{showCreate ? 'Close order form' : 'Create order'}</button>
      </div>
      {showCreate && <div className="rounded border border-bd p-3 mb-4">
        <h3 className="font-semibold mb-2">New order</h3>
        <div className="grid sm:grid-cols-2 gap-x-3">
          <SelectField label="Store" value={storeIdForCreate} onChange={(event) => setStore(event.target.value)}>{(me?.stores ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
          <SelectField label="Product variant" value={variantId} onChange={(event) => setVariantId(Number(event.target.value))}><option value={0}>Choose an item</option>{availableVariants.map((item) => <option key={item.id} value={item.id}>{item.name} · {currencyFormat(String(item.price), currency)}</option>)}</SelectField>
          <Field label="Quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <Field label="Customer name (optional)" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          <Field label="Customer phone (optional)" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
          <Field label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {products.isLoading && <QueryState loading />}{products.error && <p role="alert" className="text-er">{products.error.message}</p>}
        <button className="btn" disabled={create.isPending || products.isLoading || !availableVariants.length} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create draft order'}</button>
      </div>}
      {actionError && <p role="alert" className="text-er mb-3">{actionError}</p>}
      {orders.isLoading ? <QueryState loading /> : orders.error ? <p role="alert" className="text-er">{orders.error.message}</p> : orders.data?.length ? <Table head={['Order', 'Customer', 'Status', 'Items', 'Total', 'Paid', 'Due', 'Date', 'Details']}>
        {orders.data.map((order) => <tr key={order.id}>
          <td className="td">{order.order_number}<small className="block text-mu">Store {me.stores.find((item) => item.id === order.store_id)?.name ?? order.store_id}</small></td>
          <td className="td">{order.customer_name || 'Walk-in'}<small className="block text-mu">{order.customer_phone ?? ''}</small></td><td className="td">{order.status}</td><td className="td">{order.items.length}</td>
          <td className="td">{currencyFormat(order.total_amount, currency)}</td><td className="td">{currencyFormat(order.paid_amount, currency)}</td><td className="td">{currencyFormat(order.balance_due, currency)}</td><td className="td whitespace-nowrap">{new Date(order.created_at).toLocaleString()}</td>
          <td className="td"><button className="lnk" onClick={() => setSelectedId(order.id)}>View details</button></td>
        </tr>)}
      </Table> : <p className="text-mu">No orders match this search and filter.</p>}
    </Panel>
    {selectedId && <Panel title="Order details"><button className="lnk mb-3" onClick={() => setSelectedId('')}>Close details</button>
      {detail.isLoading ? <QueryState loading /> : detail.error ? <p role="alert" className="text-er">{detail.error.message}</p> : detail.data && <>
        <div className="grid sm:grid-cols-3 gap-2 mb-3"><p><b>Business:</b> {me.business?.name} ({detail.data.business_id})</p><p><b>Order:</b> {detail.data.order_number}</p><p><b>Status:</b> {detail.data.status}</p><p><b>Customer:</b> {detail.data.customer_name ?? 'Walk-in'} · {detail.data.customer_phone ?? 'No phone'}</p><p><b>Subtotal:</b> {currencyFormat(detail.data.subtotal, currency)}</p><p><b>Discount:</b> {currencyFormat(detail.data.discount, currency)}</p><p><b>Total:</b> {currencyFormat(detail.data.total_amount, currency)}</p><p><b>Paid:</b> {currencyFormat(detail.data.paid_amount, currency)}</p><p><b>Balance due:</b> {currencyFormat(detail.data.balance_due, currency)}</p><p><b>Created:</b> {new Date(detail.data.created_at).toLocaleString()}</p><p><b>Updated:</b> {new Date(detail.data.updated_at).toLocaleString()}</p><p><b>Payment:</b> {detail.data.paid_amount === '0.00' ? 'Unpaid' : Number(detail.data.balance_due) > 0 ? 'Partially paid' : 'Paid'}</p></div>
        <Table head={['Product', 'Variant', 'SKU', 'Quantity', 'Unit price', 'Line total']}>
          {detail.data.items.map((item) => <tr key={item.id}><td className="td">{item.product_name}</td><td className="td">{item.variant_name}</td><td className="td">{item.sku}</td><td className="td">{item.quantity}</td><td className="td">{currencyFormat(item.unit_price, currency)}</td><td className="td">{currencyFormat(item.line_total, currency)}</td></tr>)}
        </Table>
        {detail.data.note && <p className="mt-3"><b>Note:</b> {detail.data.note}</p>}
        <div className="mt-3">{orderActions(detail.data)}</div>
      </>}
    </Panel>}
  </div>
}
