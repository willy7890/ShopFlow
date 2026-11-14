
import { z } from 'zod'

export const workspaceInput = z.object({
  ownerName: z.string().trim().min(2, 'Enter the owner name.').max(160, 'Name must be at most 160 characters.'),

  // Allow usernames with spaces and special characters.
  ownerUsername: z.string().trim().min(1, 'Enter a username.').max(80, 'Username must be at most 80 characters.'),

  ownerPassword: z.string().min(8, 'Password must be at least 8 characters.').max(128, 'Password must be at most 128 characters.'),

  businessName: z.string().trim().min(2, 'Enter the business name.').max(180, 'Business name must be at most 180 characters.'),

  storeName: z.string().trim().min(2, 'Enter the store name.').max(180, 'Store name must be at most 180 characters.'),
})

export const productInput = z.object({
  name: z.string().trim().min(1, 'Enter the product name.').max(180, 'Product name must be at most 180 characters.'),
  sku: z.string().trim().min(1, 'Enter a stock keeping unit.').max(80, 'SKU must be at most 80 characters.'),
  barcode: z.string().trim().max(80, 'Barcode must be at most 80 characters.').nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unitCode: z.string().trim().min(1, 'Enter a unit.').max(20, 'Unit must be at most 20 characters.'),
  costPriceMinor: z.number().int().safe().nonnegative('Cost cannot be negative.'),
  sellPriceMinor: z.number().int().safe().nonnegative('Price cannot be negative.'),
  initialQuantity: z.number().int().safe().nonnegative('Stock cannot be negative.'),
  lowStockThreshold: z.number().int().safe().nonnegative('Threshold cannot be negative.'),
})

export const employeeRole = z.enum([
  'manager',
  'store_manager',
  'cashier',
  'accountant',
  'inventory_manager',
])

export const employeeInput = z.object({
  displayName: z.string().trim().min(2, 'Enter the employee name.').max(160, 'Name must be at most 160 characters.'),

  // Employee usernames also accept spaces and special characters.
  username: z.string().trim().min(1, 'Enter a username.').max(80, 'Username must be at most 80 characters.'),

  password: z.string().min(8, 'Password must be at least 8 characters.').max(128, 'Password must be at most 128 characters.'),
  role: employeeRole,
  storeIds: z.array(z.string().uuid()).min(1, 'Assign the employee to at least one store.'),
  permissions: z.array(z.enum([
    'manage_business',
    'manage_stores',
    'manage_employees',
    'manage_products',
    'manage_inventory',
    'sell',
    'view_reports',
    'manage_settings',
    'view_dashboard',
    'manage_finance',
    'manage_customers',
    'manage_suppliers',
  ])).min(1, 'Choose at least one permission.'),
})

export const storeInput = z.object({
  name: z.string().trim().min(2, 'Enter the store name.').max(180, 'Store name must be at most 180 characters.'),
  code: z.string().trim().min(2, 'Store code must be at least 2 characters.').max(20, 'Store code must be at most 20 characters.')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, hyphens or underscores for the store code.'),
})

export const stockAdjustmentInput = z.object({
  variantId: z.string().uuid(),
  quantityDelta: z.number().int().safe().refine((value) => value !== 0, 'Adjustment cannot be zero.'),
  reason: z.string().trim().min(3, 'Enter a reason for this stock change.').max(240, 'Reason must be at most 240 characters.'),
})

export const cashSaleInput = z.object({
  items: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().safe().positive(),
  })).min(1, 'Add at least one item.').max(500, 'A sale cannot contain more than 500 lines.').refine(
    (items) => new Set(items.map((item) => item.variantId)).size === items.length,
    'A product can only appear once in the cart.',
  ),
  cashTenderedMinor: z.number().int().safe().nonnegative('Enter a valid cash amount.'),
  customerId: z.string().uuid().optional(),
})

export const accountInput = z.object({
  name: z.string().trim().min(2, 'Enter a name.').max(160, 'Name must be at most 160 characters.'),
  phone: z.string().trim().max(40, 'Phone number must be at most 40 characters.').optional(),
})

export type WorkspaceInput = z.infer<typeof workspaceInput>
export type ProductInput = z.infer<typeof productInput>
export type CashSaleInput = z.infer<typeof cashSaleInput>
export type EmployeeInput = z.infer<typeof employeeInput>
export type EmployeeRole = z.infer<typeof employeeRole>
export type StoreInput = z.infer<typeof storeInput>
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInput>
