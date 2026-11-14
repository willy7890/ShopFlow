import type { ProductAuditEvent } from '@/src/repositories/productAudit'

type AuditValue = string | number | boolean | null | undefined
type AuditRecord = Record<string, AuditValue>

export interface AuditDetail {
  key: string
  labelKey: string
  previous?: string
  current: string
}

const fields: Array<{
  key: string
  aliases: string[]
  labelKey: string
  kind: 'text' | 'money' | 'number'
}> = [
  { key: 'name', aliases: ['name'], labelKey: 'products.audit.name', kind: 'text' },
  { key: 'sku', aliases: ['sku'], labelKey: 'products.audit.sku', kind: 'text' },
  { key: 'barcode', aliases: ['barcode'], labelKey: 'products.audit.barcode', kind: 'text' },
  { key: 'unitCode', aliases: ['unitCode', 'unit_code'], labelKey: 'products.audit.unit', kind: 'text' },
  { key: 'costPriceMinor', aliases: ['costPriceMinor', 'cost_price_minor', 'purchase_price'], labelKey: 'products.audit.purchasePrice', kind: 'money' },
  { key: 'sellPriceMinor', aliases: ['sellPriceMinor', 'sell_price_minor', 'selling_price'], labelKey: 'products.audit.sellingPrice', kind: 'money' },
  { key: 'initialQuantity', aliases: ['initialQuantity', 'initial_quantity'], labelKey: 'products.audit.initialQuantity', kind: 'number' },
  { key: 'lowStockThreshold', aliases: ['lowStockThreshold', 'low_stock_threshold'], labelKey: 'products.audit.lowStockThreshold', kind: 'number' },
]

function recordFromJson(value: string | null | undefined): AuditRecord | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as AuditRecord
  } catch {
    return null
  }
}

function fieldValue(record: AuditRecord | null, aliases: string[]): AuditValue {
  if (!record) return undefined
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) return record[alias]
  }
  return undefined
}

function valuesEqual(left: AuditValue, right: AuditValue): boolean {
  return String(left ?? '') === String(right ?? '')
}

function formatValue(value: AuditValue, kind: 'text' | 'money' | 'number', formatNumber: (value: number) => string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (kind === 'text') return typeof value === 'string' ? value : undefined
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return undefined
  return kind === 'money' ? `TSh ${formatNumber(numeric)}` : formatNumber(numeric)
}

export function productAuditDetails(
  event: Pick<ProductAuditEvent, 'eventType' | 'beforeJson' | 'afterJson' | 'categoryName'>,
  formatNumber: (value: number) => string,
): AuditDetail[] {
  const before = recordFromJson(event.beforeJson)
  const after = recordFromJson(event.afterJson)
  if (!after) return []

  if (event.eventType === 'stock_adjusted') {
    const quantityDelta = fieldValue(after, ['quantityDelta', 'quantity_delta'])
    const quantity = formatValue(quantityDelta, 'number', formatNumber)
    const details: AuditDetail[] = quantity
      ? [{ key: 'quantityDelta', labelKey: 'products.audit.quantityChange', current: `${Number(quantityDelta) > 0 ? '+' : ''}${quantity}` }]
      : []
    const reason = fieldValue(after, ['reason'])
    if (typeof reason === 'string' && reason.trim()) {
      details.push({ key: 'reason', labelKey: 'products.audit.reason', current: reason.trim() })
    }
    return details
  }

  const details: AuditDetail[] = fields.flatMap((field) => {
    const currentValue = fieldValue(after, field.aliases)
    if (currentValue === undefined) return []
    const current = formatValue(currentValue, field.kind, formatNumber)
    if (!current) return []
    const previousValue = fieldValue(before, field.aliases)
    const previous = formatValue(previousValue, field.kind, formatNumber)
    if (previousValue !== undefined && !valuesEqual(previousValue, currentValue) && previous) {
      return [{ key: field.key, labelKey: field.labelKey, previous, current }]
    }
    return [{ key: field.key, labelKey: field.labelKey, current }]
  })

  const previousCategory = fieldValue(before, ['categoryName'])
  if (
    event.eventType === 'updated'
    && typeof previousCategory === 'string'
    && previousCategory !== event.categoryName
  ) {
    details.push({
      key: 'categoryName',
      labelKey: 'products.audit.category',
      previous: previousCategory,
      current: event.categoryName,
    })
  }
  return details
}

export function productAuditAction(eventType: string): 'created' | 'updated' | 'stock_adjusted' | 'deleted' | 'unknown' {
  if (eventType === 'created' || eventType === 'updated' || eventType === 'stock_adjusted' || eventType === 'deleted') {
    return eventType
  }
  return 'unknown'
}
