export function parseTzsAmount(value: string): number | null {
  const normalized = value.trim().replaceAll(',', '')
  if (!/^\d+$/.test(normalized)) return null

  const amount = Number(normalized)
  return Number.isSafeInteger(amount) ? amount : null
}

export function multiplyMoney(unitAmount: number, quantity: number): number {
  if (!Number.isSafeInteger(unitAmount) || unitAmount < 0) {
    throw new Error('Unit price must be a non-negative whole TZS amount.')
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive whole number.')
  }

  const total = unitAmount * quantity
  if (!Number.isSafeInteger(total)) {
    throw new Error('Amount is too large to represent safely.')
  }
  return total
}

export function cartTotal(items: Array<{ unitAmount: number; quantity: number }>): number {
  return items.reduce((sum, item) => {
    if (item.quantity === 0) return sum
    return sum + multiplyMoney(item.unitAmount, item.quantity)
  }, 0)
}

export function formatTzs(amountMinor: number, language: 'en' | 'sw' = 'en'): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error('Amount must be a non-negative whole TZS value.')
  }
  const locale = language === 'sw' ? 'sw-TZ' : 'en-TZ'
  return `TZS ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amountMinor)}`
}
