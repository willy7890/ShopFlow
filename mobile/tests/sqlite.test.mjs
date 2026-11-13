import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { migrateDatabase } from '../src/database/migrations.ts'
import {
  createCategory,
  createProduct,
  deleteCategory,
  findProductByBarcode,
  findProductByCode,
  listCategories,
  listProducts,
  updateProduct,
} from '../src/repositories/catalog.ts'
import { adjustStock, listRecentMovements } from '../src/repositories/inventory.ts'
import { listProductAuditEvents } from '../src/repositories/productAudit.ts'
import {
  createCashSale,
  completeSaleRefund,
  getSaleRefundRequest,
  getSaleDetail,
  getSalesSummary,
  listSalePayments,
  listRecentSales,
  prepareSaleRefund,
} from '../src/repositories/sales.ts'
import {
  createCustomer,
  createSupplier,
  listCustomers,
  listCustomerLedgerEntries,
  listSuppliers,
  listSupplierLedgerEntries,
  recordCustomerPayment,
  recordSupplierBill,
  recordSupplierPayment,
  setCustomerArchived,
  setSupplierArchived,
  updateCustomer,
  updateSupplier,
} from '../src/repositories/accounts.ts'
import {
  cashbookEntriesToCsv,
  createManualCashbookEntry,
  getCashbookTotals,
  getLocalReport,
  listCashbookEntries,
  recordOpeningBalance,
  reconcileCashbook,
} from '../src/repositories/cashbook.ts'
import {
  assertAnyPermission,
  assertPermission,
  activateRemoteWorkspace,
  authenticateUser,
  clearActiveSession,
  createWorkspace,
  getActiveWorkspace,
  listStores,
  restoreLocalWorkspace,
  switchStore,
} from '../src/repositories/workspace.ts'
import {
  createEmployee,
  createStore,
  getLocalPreferences,
  saveLocalPreferences,
  updateEmployeeAccess,
  updateEmployeeProfile,
} from '../src/repositories/administration.ts'
import { getLocalInsights, listNotificationQueue } from '../src/services/insights.ts'
import { validateShopFlowBackup } from '../src/services/backupValidation.ts'
import { listSyncQueue, retryFailedSyncItems } from '../src/repositories/syncQueue.ts'

function openTestDatabase(path) {
  const sqlite = new DatabaseSync(path)
  const database = {
    execAsync: async (sql) => sqlite.exec(sql),
    getFirstAsync: async (sql, ...parameters) => sqlite.prepare(sql).get(...parameters) ?? null,
    getAllAsync: async (sql, ...parameters) => sqlite.prepare(sql).all(...parameters),
    runAsync: async (sql, ...parameters) => {
      const result = sqlite.prepare(sql).run(...parameters)
      return { changes: Number(result.changes) }
    },
    withExclusiveTransactionAsync: async (operation) => {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        await operation(database)
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    close: () => sqlite.close(),
  }
  return database
}

test('SQLite migrations, offline sale persistence and stock rollback are consistent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-sqlite-test-'))
  const databasePath = join(directory, 'shopflow.db')
  let database = openTestDatabase(databasePath)
  try {
    await migrateDatabase(database)
    await migrateDatabase(database)
    assert.equal((await database.getFirstAsync('PRAGMA user_version')).user_version, 12)
    await validateShopFlowBackup(database)

    const workspace = await createWorkspace(database, {
      ownerName: 'Asha Mushi',
      ownerUsername: 'asha',
      ownerPassword: 'a-secure-local-password',
      businessName: 'Asha Shop',
      storeName: 'Main Store',
    }, randomUUID)
    assert.deepEqual({ ...await getActiveWorkspace(database) }, workspace)
    const storedOwner = await database.getFirstAsync(
      'SELECT password_hash AS passwordHash, password_iterations AS passwordIterations FROM users WHERE id = ?',
      workspace.ownerId,
    )
    assert.notEqual(storedOwner.passwordHash, 'a-secure-local-password')
    assert.equal(storedOwner.passwordIterations, 100000)

    await createStore(database, workspace, { name: 'Second Store', code: 'SECOND' }, randomUUID)
    const stores = await listStores(database, workspace)
    assert.equal(stores.length, 2)
    const secondStore = stores.find((store) => store.code === 'SECOND')
    assert.ok(secondStore)
    await switchStore(database, workspace, secondStore.id)
    const secondWorkspace = await getActiveWorkspace(database)
    assert.ok(secondWorkspace)
    assert.deepEqual(await listProducts(database, secondWorkspace), [])
    await switchStore(database, secondWorkspace, workspace.storeId)
    assert.deepEqual({ ...await getActiveWorkspace(database) }, workspace)

    await createCategory(database, workspace, 'Beverages', randomUUID)
    const [category] = await listCategories(database, workspace)
    await createProduct(database, workspace, {
      name: 'Tea',
      sku: 'TEA-250',
      barcode: '1234567890123',
      categoryId: category.id,
      unitCode: 'pcs',
      costPriceMinor: 300,
      sellPriceMinor: 500,
      initialQuantity: 3,
      lowStockThreshold: 1,
    }, randomUUID)
    const [product] = await listProducts(database, workspace)
    assert.equal(product.quantity, 3)
    assert.equal(product.sellPriceMinor, 500)
    assert.equal(product.barcode, '1234567890123')
    assert.equal(product.categoryName, 'Beverages')
    assert.equal((await listProducts(database, workspace, '1234567890123')).length, 1)
    assert.equal((await findProductByBarcode(database, workspace, ' 1234567890123 ')).variantId, product.variantId)
    assert.equal((await findProductByCode(database, workspace, 'TEA-250')).variantId, product.variantId)
    assert.equal(await findProductByBarcode(database, workspace, '0000000000000'), null)
    assert.equal(await findProductByBarcode(database, workspace, '   '), null)
    assert.equal(await findProductByCode(database, workspace, 'unknown-qr-value'), null)
    await assert.rejects(createProduct(database, workspace, {
      name: 'Duplicate tea',
      sku: 'TEA-DUP',
      barcode: '1234567890123',
      unitCode: 'pcs',
      costPriceMinor: 300,
      sellPriceMinor: 500,
      initialQuantity: 1,
      lowStockThreshold: 0,
    }, randomUUID), /product code is already assigned/)
    await assert.rejects(createProduct(database, workspace, {
      name: 'Duplicate SKU as barcode',
      sku: '1234567890123',
      barcode: '9876543210000',
      unitCode: 'pcs',
      costPriceMinor: 300,
      sellPriceMinor: 500,
      initialQuantity: 1,
      lowStockThreshold: 0,
    }, randomUUID), /product code is already assigned/)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM products')).count, 1)
    await switchStore(database, workspace, secondStore.id)
    const secondStoreWorkspace = await getActiveWorkspace(database)
    assert.ok(secondStoreWorkspace)
    assert.equal((await listProducts(database, secondStoreWorkspace))[0].quantity, 0)
    await switchStore(database, secondStoreWorkspace, workspace.storeId)
    assert.equal((await listRecentMovements(database, workspace))[0].quantityDelta, 3)

    await database.execAsync(`
      CREATE TRIGGER reject_test_payment BEFORE INSERT ON payments
      BEGIN SELECT RAISE(ABORT, 'payment rejected for rollback test'); END;
    `)
    await assert.rejects(
      createCashSale(database, workspace, {
        items: [{ variantId: product.variantId, quantity: 2 }],
        cashTenderedMinor: 1200,
      }, randomUUID),
      /payment rejected for rollback test/,
    )
    assert.equal((await listProducts(database, workspace))[0].quantity, 3)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM sales')).count, 0)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM outbox')).count, 0)
    await database.execAsync('DROP TRIGGER reject_test_payment')

    const sale = await createCashSale(database, workspace, {
      items: [{ variantId: product.variantId, quantity: 2 }],
      cashTenderedMinor: 1200,
    }, randomUUID)
    assert.equal(sale.totalMinor, 1000)
    assert.equal(sale.changeMinor, 200)
    assert.equal((await listProducts(database, workspace))[0].quantity, 1)
    await assert.rejects(
      createCashSale(database, workspace, {
        items: [{ variantId: product.variantId, quantity: 2 }],
        cashTenderedMinor: 1200,
      }, randomUUID),
      /only 1 in stock/,
    )
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM sales')).count, 1)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM payments')).count, 1)
    const sales = await listRecentSales(database, workspace)
    assert.equal(sales.length, 1)
    assert.equal(sales[0].saleNumber, sale.saleNumber)
    assert.equal(sales[0].itemCount, 1)
    assert.equal((await listRecentSales(database, workspace, 'not found')).length, 0)
    const salePayments = await listSalePayments(database, workspace)
    assert.equal(salePayments.length, 1)
    assert.equal(salePayments[0].saleNumber, sale.saleNumber)
    assert.equal(salePayments[0].amountMinor, 1000)
    assert.equal(salePayments[0].method, 'cash')
    assert.equal(salePayments[0].status, 'confirmed')
    assert.equal((await listSalePayments(database, workspace, 'not found')).length, 0)
    const saleDetail = await getSaleDetail(database, workspace, sale.saleId)
    assert.equal(saleDetail.totalMinor, 1000)
    assert.equal(saleDetail.paidMinor, 1000)
    assert.equal(saleDetail.items[0].productName, 'Tea')
    assert.equal(saleDetail.items[0].lineTotalMinor, 1000)
    await switchStore(database, workspace, secondStore.id)
    const otherStoreWorkspace = await getActiveWorkspace(database)
    assert.ok(otherStoreWorkspace)
    assert.deepEqual(await listRecentSales(database, otherStoreWorkspace), [])
    assert.equal(await getSaleDetail(database, otherStoreWorkspace, sale.saleId), null)
    await switchStore(database, otherStoreWorkspace, workspace.storeId)

    const outbox = await database.getFirstAsync(
      `SELECT client_id AS clientId, status, payload_json AS payloadJson
       FROM outbox WHERE entity_type = 'sale'`,
    )
    assert.equal(outbox.clientId, sale.saleId)
    assert.equal(outbox.status, 'pending')
    const outboxPayload = JSON.parse(outbox.payloadJson)
    assert.equal(outboxPayload.items[0].unitPriceMinor, 500)
    assert.equal(outboxPayload.items[0].lineTotalMinor, 1000)
    assert.equal(outboxPayload.payments[0].amountMinor, 1000)
    await database.runAsync(
      `UPDATE outbox SET status = 'failed', last_error = 'Server unavailable'
       WHERE client_id = ?`,
      sale.saleId,
    )
    await database.runAsync("UPDATE sales SET sync_state = 'failed' WHERE id = ?", sale.saleId)
    const queue = await listSyncQueue(database, workspace)
    assert.ok(queue.some((item) => item.clientId === sale.saleId && item.lastError === 'Server unavailable'))
    await database.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('active_context', 'online')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    )
    assert.equal(await retryFailedSyncItems(database, workspace), 1)
    assert.equal((await database.getFirstAsync('SELECT status FROM outbox WHERE client_id = ?', sale.saleId)).status, 'pending')
    assert.equal((await database.getFirstAsync('SELECT sync_state AS state FROM sales WHERE id = ?', sale.saleId)).state, 'pending')
    await database.runAsync("UPDATE outbox SET status = 'conflict' WHERE client_id = ?", sale.saleId)
    assert.equal(await retryFailedSyncItems(database, workspace), 0)
    assert.equal((await database.getFirstAsync('SELECT status FROM outbox WHERE client_id = ?', sale.saleId)).status, 'conflict')
    await database.runAsync("UPDATE outbox SET status = 'pending' WHERE client_id = ?", sale.saleId)
    await database.runAsync("UPDATE sales SET sync_state = 'pending' WHERE id = ?", sale.saleId)
    await database.runAsync("UPDATE app_settings SET setting_value = 'local' WHERE setting_key = 'active_context'")
    const summary = await getSalesSummary(database, workspace)
    assert.equal(summary.todayTotalMinor, 1000)
    assert.equal(summary.todayCount, 1)
    assert.equal(summary.pendingSyncCount, 2)
    assert.deepEqual({ ...await getCashbookTotals(database, workspace) }, { incomeMinor: 1000, expenseMinor: 0 })

    const refundRequest = {
      saleId: sale.saleId,
      serverSaleId: 'remote-sale-1',
      reason: 'Customer returned the items',
      idempotencyKey: `mobile-full-refund:${sale.saleId}`,
    }
    const pendingRefund = await prepareSaleRefund(database, workspace, refundRequest, randomUUID)
    assert.equal(pendingRefund.status, 'pending')
    assert.equal((await getSaleRefundRequest(database, workspace, sale.saleId)).reason, refundRequest.reason)
    const retriedRefund = await prepareSaleRefund(database, workspace, refundRequest, randomUUID)
    assert.deepEqual({ ...retriedRefund }, { ...pendingRefund })
    await completeSaleRefund(database, workspace, {
      ...pendingRefund,
      amountMinor: 1000,
      status: 'refunded',
    }, randomUUID)
    await completeSaleRefund(database, workspace, {
      ...pendingRefund,
      amountMinor: 1000,
      status: 'refunded',
    }, randomUUID)
    const refundedSale = await getSaleDetail(database, workspace, sale.saleId)
    assert.equal(refundedSale.refundMinor, 1000)
    assert.equal(refundedSale.refundStatus, 'refunded')
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM sale_refunds')).count, 1)
    const paymentHistory = await listSalePayments(database, workspace)
    assert.equal(paymentHistory.length, 2)
    assert.ok(paymentHistory.some((payment) => payment.method === 'refund' && payment.amountMinor === 1000))
    assert.deepEqual({ ...await getCashbookTotals(database, workspace) }, { incomeMinor: 1000, expenseMinor: 1000 })
    await assert.rejects(
      prepareSaleRefund(database, workspace, { ...refundRequest, idempotencyKey: 'different-refund' }, randomUUID),
      /different refund request/,
    )

    await assert.rejects(
      createCashSale(database, workspace, {
        items: [{ variantId: product.variantId, quantity: 2 }],
        cashTenderedMinor: 2000,
      }, randomUUID),
      /only 1 in stock/,
    )
    assert.equal((await listProducts(database, workspace))[0].quantity, 1)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM sales')).count, 1)

    await adjustStock(database, workspace, {
      variantId: product.variantId,
      quantityDelta: 2,
      reason: 'Supplier delivery',
    }, randomUUID)
    await adjustStock(database, workspace, {
      variantId: product.variantId,
      quantityDelta: -1,
      reason: 'Damaged units',
    }, randomUUID)
    assert.equal((await listProducts(database, workspace))[0].quantity, 2)
    await assert.rejects(adjustStock(database, workspace, {
      variantId: product.variantId,
      quantityDelta: -3,
      reason: 'Invalid over-reduction',
    }, randomUUID), /exceeds the available quantity/)
    const latestMovement = (await listRecentMovements(database, workspace))[0]
    assert.equal(latestMovement.reason, 'Damaged units')
    assert.equal(latestMovement.quantityDelta, -1)

    await updateProduct(database, workspace, product.productId, product.variantId, {
      name: 'Black Tea',
      sku: 'TEA-NEW',
      barcode: '9876543210123',
      categoryId: category.id,
      unitCode: 'box',
      costPriceMinor: 350,
      sellPriceMinor: 600,
      initialQuantity: 0,
      lowStockThreshold: 2,
    }, randomUUID)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM product_audit_events')).count, 4)
    const auditHistory = await listProductAuditEvents(database, workspace, 'Beverages')
    assert.deepEqual(auditHistory.map(({ eventType }) => eventType), [
      'updated',
      'stock_adjusted',
      'stock_adjusted',
      'created',
    ])
    const [updatedProduct] = await listProducts(database, workspace, 'TEA-NEW')
    assert.equal(updatedProduct.name, 'Black Tea')
    assert.equal(updatedProduct.sellPriceMinor, 600)
    assert.equal(updatedProduct.quantity, 2)
    await deleteCategory(database, workspace, category.id)
    assert.equal((await listProducts(database, workspace, 'TEA-NEW'))[0].categoryId, null)

    const employeeStoreIds = [workspace.storeId]
    await createEmployee(database, workspace, {
      displayName: 'Neema Cashier',
      username: 'neema',
      password: 'a-cashier-local-password',
      role: 'cashier',
      storeIds: employeeStoreIds,
      permissions: ['sell'],
    }, randomUUID)
    await updateEmployeeProfile(
      database,
      workspace,
      (await database.getFirstAsync("SELECT id FROM users WHERE username = 'neema'")).id,
      'Neema Cashier',
      'cashier',
      'updated-cashier-password',
      randomUUID,
    )
    await assert.rejects(authenticateUser(database, 'neema', 'a-cashier-local-password'), /incorrect/)
    await authenticateUser(database, 'neema', 'updated-cashier-password')
    const employeeWorkspace = await getActiveWorkspace(database)
    assert.equal(employeeWorkspace.userName, 'Neema Cashier')
    await assert.rejects(
      assertPermission(database, employeeWorkspace, 'manage_products'),
      /do not have permission/,
    )
    await assert.rejects(
      createProduct(database, employeeWorkspace, {
        name: 'Blocked Product',
        sku: 'BLOCKED-1',
        unitCode: 'pcs',
        costPriceMinor: 10,
        sellPriceMinor: 20,
        initialQuantity: 0,
        lowStockThreshold: 0,
      }, randomUUID),
      /do not have permission/,
    )
    await assert.rejects(
      switchStore(database, employeeWorkspace, secondStore.id),
      /not assigned/,
    )
    await authenticateUser(database, 'asha', 'a-secure-local-password')
    const ownerWorkspace = await getActiveWorkspace(database)
    assert.equal(ownerWorkspace.userId, workspace.ownerId)
    await updateEmployeeAccess(database, ownerWorkspace, employeeWorkspace.userId, employeeStoreIds, ['sell'], false)
    await assert.rejects(authenticateUser(database, 'neema', 'a-cashier-local-password'), /incorrect/)

    let preferences = await getLocalPreferences(database, ownerWorkspace)
    assert.equal(preferences.theme, 'light')
    await saveLocalPreferences(database, ownerWorkspace, {
      theme: 'dark',
      inventoryTracking: false,
      trackingMode: 'simple_sales',
    })

    preferences = await getLocalPreferences(database, ownerWorkspace)
    assert.equal(preferences.theme, 'dark')
    assert.equal(preferences.trackingMode, 'simple_sales')
    assert.equal((await listProducts(database, ownerWorkspace))[0].trackStock, 0)
    await createCashSale(database, ownerWorkspace, {
      items: [{ variantId: product.variantId, quantity: 1 }],
      cashTenderedMinor: 600,
    }, randomUUID)
    assert.equal((await listProducts(database, ownerWorkspace))[0].quantity, 2)
    await saveLocalPreferences(database, ownerWorkspace, {
      theme: 'light',
      inventoryTracking: true,
      trackingMode: 'inventory',
    })
    assert.equal((await listProducts(database, ownerWorkspace))[0].trackStock, 1)

    database.close()
    database = openTestDatabase(databasePath)
    await migrateDatabase(database)
    assert.deepEqual({ ...await getActiveWorkspace(database) }, workspace)
    assert.equal((await listProducts(database, workspace))[0].quantity, 2)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM outbox')).count, 4)
    await clearActiveSession(database)
    await assert.rejects(listProducts(database, workspace), /session or store has changed/)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('database backups reject non-ShopFlow and unsupported schemas', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-backup-validation-'))
  const database = openTestDatabase(join(directory, 'not-shopflow.db'))
  try {
    await database.execAsync('PRAGMA user_version = 1; CREATE TABLE arbitrary_data (value TEXT);')
    await assert.rejects(validateShopFlowBackup(database), /does not contain a ShopFlow database/)
    await database.execAsync('CREATE TABLE businesses (id TEXT); CREATE TABLE stores (id TEXT); CREATE TABLE users (id TEXT); CREATE TABLE app_settings (setting_key TEXT, setting_value TEXT); PRAGMA user_version = 13;')
    await assert.rejects(validateShopFlowBackup(database), /unsupported ShopFlow database version/)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('customer debts and supplier payables are isolated, balanced and atomic', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-accounts-test-'))
  const database = openTestDatabase(join(directory, 'shopflow.db'))
  try {
    await migrateDatabase(database)
    const workspace = await createWorkspace(database, {
      ownerName: 'Accounts User',
      ownerUsername: 'accounts',
      ownerPassword: 'a-local-password',
      businessName: 'Accounts Shop',
      storeName: 'Main Store',
    }, randomUUID)
    await createProduct(database, workspace, {
      name: 'Rice',
      sku: 'RICE-1',
      unitCode: 'kg',
      costPriceMinor: 600,
      sellPriceMinor: 1000,
      initialQuantity: 5,
      lowStockThreshold: 1,
    }, randomUUID)
    const [product] = await listProducts(database, workspace)
    await createCustomer(database, workspace, { name: 'Neema' }, randomUUID)
    await createSupplier(database, workspace, { name: 'Grain Supplier' }, randomUUID)
    const [customer] = await listCustomers(database, workspace)
    const [supplier] = await listSuppliers(database, workspace)

    await assert.rejects(createCashSale(database, workspace, {
      items: [{ variantId: product.variantId, quantity: 1 }],
      cashTenderedMinor: 300,
    }, randomUUID), /Select a customer to record the unpaid sale balance/)
    assert.equal((await listProducts(database, workspace))[0].quantity, 5)

    await database.execAsync(`
      CREATE TRIGGER reject_customer_debt BEFORE INSERT ON customer_ledger
      BEGIN SELECT RAISE(ABORT, 'customer ledger rejected'); END;
    `)
    await assert.rejects(createCashSale(database, workspace, {
      items: [{ variantId: product.variantId, quantity: 1 }],
      cashTenderedMinor: 300,
      customerId: customer.id,
    }, randomUUID), /customer ledger rejected/)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM sales')).count, 0)
    assert.equal((await listProducts(database, workspace))[0].quantity, 5)
    await database.execAsync('DROP TRIGGER reject_customer_debt')

    const sale = await createCashSale(database, workspace, {
      items: [{ variantId: product.variantId, quantity: 1 }],
      cashTenderedMinor: 300,
      customerId: customer.id,
    }, randomUUID)
    assert.equal(sale.totalMinor, 1000)
    assert.equal(sale.changeMinor, 0)
    assert.equal(sale.balanceDueMinor, 700)
    const savedSale = await database.getFirstAsync(
      'SELECT customer_name_snapshot AS customerName, paid_minor AS paid, balance_due_minor AS due FROM sales WHERE id = ?',
      sale.saleId,
    )
    assert.deepEqual({ ...savedSale }, { customerName: 'Neema', paid: 300, due: 700 })
    assert.equal((await database.getFirstAsync('SELECT amount_minor AS amount FROM payments WHERE sale_id = ?', sale.saleId)).amount, 300)
    assert.equal((await listCustomers(database, workspace))[0].balanceMinor, 700)

    await assert.rejects(recordCustomerPayment(database, workspace, customer.id, 701, '', randomUUID), /cannot exceed the outstanding balance/)
    await recordCustomerPayment(database, workspace, customer.id, 200, 'Part payment', randomUUID)
    assert.equal((await listCustomers(database, workspace))[0].balanceMinor, 500)
    const customerStatement = await listCustomerLedgerEntries(database, workspace, customer.id)
    assert.equal(customerStatement.length, 2)
    assert.deepEqual(customerStatement.map(({ entryType, amountMinor }) => ({ entryType, amountMinor })), [
      { entryType: 'payment', amountMinor: 200 },
      { entryType: 'debt', amountMinor: 700 },
    ])

    const originalStock = (await listProducts(database, workspace))[0].quantity
    await recordSupplierBill(database, workspace, supplier.id, 800, 'Flour delivery invoice', randomUUID)
    assert.equal((await listSuppliers(database, workspace))[0].balanceMinor, 800)
    assert.equal((await listProducts(database, workspace))[0].quantity, originalStock)
    assert.equal((await getCashbookTotals(database, workspace)).expenseMinor, 0)
    await assert.rejects(recordSupplierPayment(database, workspace, supplier.id, 801, '', randomUUID), /cannot exceed the outstanding balance/)
    await recordSupplierPayment(database, workspace, supplier.id, 300, '', randomUUID)
    assert.equal((await listSuppliers(database, workspace))[0].balanceMinor, 500)
    const supplierStatement = await listSupplierLedgerEntries(database, workspace, supplier.id)
    assert.equal(supplierStatement.length, 2)
    assert.deepEqual(supplierStatement.map(({ entryType, amountMinor }) => ({ entryType, amountMinor })), [
      { entryType: 'payment', amountMinor: 300 },
      { entryType: 'bill', amountMinor: 800 },
    ])
    assert.equal((await getCashbookTotals(database, workspace)).expenseMinor, 300)
    await createManualCashbookEntry(database, workspace, {
      entryType: 'income',
      category: 'Other income',
      amountMinor: 1000,
      note: 'Manual cash receipt',
    }, randomUUID)
    await createManualCashbookEntry(database, workspace, {
      entryType: 'expense',
      category: 'Transport',
      amountMinor: 50,
      note: '',
    }, randomUUID)
    const cashbookTotals = await getCashbookTotals(database, workspace)
    assert.deepEqual({ ...cashbookTotals }, { incomeMinor: 1500, expenseMinor: 350 })
    assert.equal((await listCashbookEntries(database, workspace)).length, 5)
    assert.equal((await listCashbookEntries(database, workspace, { days: 7, search: 'Transport' })).length, 1)
    assert.match(cashbookEntriesToCsv([{
      id: 'csv-test',
      entryType: 'expense',
      source: 'manual',
      category: 'Fuel, local',
      amountMinor: 50,
      note: 'Driver said "paid"',
      createdAt: '2025-01-01T00:00:00.000Z',
    }]), /"Fuel, local",50,"Driver said ""paid""/)
    const report = await getLocalReport(database, workspace, 30)
    assert.equal(report.salesTotalMinor, 1000)
    assert.equal(report.salesCount, 1)
    assert.equal(report.incomeMinor, 1500)
    assert.equal(report.expenseMinor, 350)
    assert.equal(report.netCashMinor, 1150)
    assert.equal(report.customerDebtMinor, 500)
    assert.equal(report.supplierPayableMinor, 500)
    assert.deepEqual(report.topProducts.map((item) => item.name), ['Rice'])

    await updateCustomer(database, workspace, customer.id, { name: 'Neema Updated' }, randomUUID)
    await setCustomerArchived(database, workspace, customer.id, true, randomUUID)
    assert.equal((await listCustomers(database, workspace)).length, 0)
    assert.equal((await listCustomers(database, workspace, true))[0].name, 'Neema Updated')
    assert.equal((await listCustomerLedgerEntries(database, workspace, customer.id)).length, 2)
    await assert.rejects(recordCustomerPayment(database, workspace, customer.id, 100, '', randomUUID), /not available/)
    await setCustomerArchived(database, workspace, customer.id, false, randomUUID)
    assert.equal((await listCustomers(database, workspace))[0].isActive, 1)

    await updateSupplier(database, workspace, supplier.id, { name: 'Grain Supplier Updated' }, randomUUID)
    await setSupplierArchived(database, workspace, supplier.id, true, randomUUID)
    assert.equal((await listSuppliers(database, workspace)).length, 0)
    assert.equal((await listSuppliers(database, workspace, true))[0].name, 'Grain Supplier Updated')
    assert.equal((await listSupplierLedgerEntries(database, workspace, supplier.id)).length, 2)
    await assert.rejects(recordSupplierBill(database, workspace, supplier.id, 100, '', randomUUID), /not available/)
    await setSupplierArchived(database, workspace, supplier.id, false, randomUUID)
    assert.equal((await listSuppliers(database, workspace))[0].isActive, 1)

    await recordOpeningBalance(database, workspace, {
      entryType: 'income',
      amountMinor: 2000,
      note: 'Opening cash',
    }, randomUUID)
    await assert.rejects(recordOpeningBalance(database, workspace, {
      entryType: 'income',
      amountMinor: 100,
      note: 'Duplicate',
    }, randomUUID), /already been set/)
    assert.equal(await reconcileCashbook(database, workspace, 3200, 'Counted cash', randomUUID), 50)
    assert.equal(await reconcileCashbook(database, workspace, 3100, 'Corrected count', randomUUID), -100)
    assert.equal(await reconcileCashbook(database, workspace, 3100, 'No variance', randomUUID), 0)
    assert.deepEqual({ ...await getCashbookTotals(database, workspace) }, { incomeMinor: 3550, expenseMinor: 450 })

    await createStore(database, workspace, { name: 'Second Store', code: 'SECOND' }, randomUUID)
    const secondStore = (await listStores(database, workspace)).find((store) => store.code === 'SECOND')
    assert.ok(secondStore)
    await switchStore(database, workspace, secondStore.id)
    const secondWorkspace = await getActiveWorkspace(database)
    assert.ok(secondWorkspace)
    assert.equal((await listCustomers(database, secondWorkspace))[0].balanceMinor, 0)
    assert.equal((await listSuppliers(database, secondWorkspace))[0].balanceMinor, 0)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM outbox')).count, 20)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('local sales insights and notifications summarize low stock and sell-through trends', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-insights-test-'))
  const databasePath = join(directory, 'shopflow.db')
  const database = openTestDatabase(databasePath)
  try {
    await migrateDatabase(database)
    const workspace = await createWorkspace(database, {
      ownerName: 'Insight User',
      ownerUsername: 'insight',
      ownerPassword: 'a-local-password',
      businessName: 'Insight Shop',
      storeName: 'Downtown',
    }, randomUUID)

    await createCategory(database, workspace, 'Beverages', randomUUID)
    const [category] = await listCategories(database, workspace)
    await createProduct(database, workspace, {
      name: 'Coke',
      sku: 'COLA-1',
      barcode: '2000000000001',
      categoryId: category.id,
      unitCode: 'pcs',
      costPriceMinor: 1200,
      sellPriceMinor: 2000,
      initialQuantity: 3,
      lowStockThreshold: 2,
    }, randomUUID)
    const [product] = await listProducts(database, workspace)

    await createCashSale(database, workspace, {
      items: [{ variantId: product.variantId, quantity: 2 }],
      cashTenderedMinor: 4500,
    }, randomUUID)

    const summary = await getLocalInsights(database, workspace)
    assert.equal(summary.todayTotalMinor, 4000)
    assert.equal(summary.todayCount, 1)
    assert.equal(summary.topSeller.name, 'Coke')
    assert.equal(summary.topSeller.units, 2)
    assert.equal(summary.lowStock.length, 1)
    assert.equal(summary.lowStock[0].sku, 'COLA-1')
    assert.equal(summary.lowStock[0].available, 1)
    assert.match(summary.recommendation, /Reorder Coke/)

    const notifications = await listNotificationQueue(database, workspace)
    assert.equal(notifications.some((item) => item.kind === 'low_stock'), true)
    assert.equal(notifications.some((item) => item.kind === 'sales'), true)
    assert.equal(notifications[0].severity === 'warning' || notifications[0].severity === 'critical', true)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('version 1 local business data upgrades in place and persists the default language', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-v1-upgrade-test-'))
  const database = openTestDatabase(join(directory, 'shopflow.db'))
  try {
    await database.execAsync(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE businesses (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'TZS',
        timezone TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam', created_at TEXT NOT NULL
      );
      CREATE TABLE stores (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name TEXT NOT NULL, code TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
        UNIQUE (business_id, code)
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'store_manager', 'cashier', 'accountant', 'inventory_manager')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY NOT NULL, setting_value TEXT NOT NULL);
      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (business_id, name)
      );
      CREATE TABLE products (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE product_variants (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        label TEXT NOT NULL, sku TEXT NOT NULL, unit_code TEXT NOT NULL DEFAULT 'pcs',
        cost_price_minor INTEGER NOT NULL, sell_price_minor INTEGER NOT NULL,
        low_stock_threshold INTEGER NOT NULL DEFAULT 0, track_stock INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE (business_id, sku)
      );
      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        variant_id TEXT NOT NULL, movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL,
        unit_cost_minor INTEGER NOT NULL DEFAULT 0, reference_type TEXT, reference_id TEXT,
        actor_id TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE sales (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, sale_number TEXT NOT NULL,
        subtotal_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL DEFAULT 0,
        total_minor INTEGER NOT NULL, cash_tendered_minor INTEGER NOT NULL,
        change_minor INTEGER NOT NULL, sync_state TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL, UNIQUE (business_id, sale_number)
      );
      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY NOT NULL, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
        product_name_snapshot TEXT NOT NULL, variant_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL,
        unit_price_minor INTEGER NOT NULL, line_total_minor INTEGER NOT NULL
      );
      CREATE TABLE payments (
        id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        method TEXT NOT NULL, amount_minor INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO businesses (id, name, created_at) VALUES ('business-v1', 'Existing Shop', '2025-01-01');
      INSERT INTO stores (id, business_id, name, code, created_at)
        VALUES ('store-v1', 'business-v1', 'Original Store', 'MAIN', '2025-01-01');
      INSERT INTO users (id, business_id, display_name, role, created_at)
        VALUES ('owner-v1', 'business-v1', 'Existing Owner', 'owner', '2025-01-01');
      INSERT INTO products (id, business_id, name, created_at)
        VALUES ('product-v1', 'business-v1', 'Legacy Product', '2025-01-01');
      INSERT INTO product_variants
        (id, business_id, product_id, label, sku, cost_price_minor, sell_price_minor, created_at)
        VALUES ('variant-v1', 'business-v1', 'product-v1', 'Default', 'LEGACY-1', 100, 200, '2025-01-01');
      INSERT INTO sales
        (id, business_id, store_id, actor_id, sale_number, subtotal_minor, total_minor,
         cash_tendered_minor, change_minor, created_at)
        VALUES ('sale-v1', 'business-v1', 'store-v1', 'owner-v1', 'S-LEGACY', 200, 200, 200, 0, '2025-01-01');
      INSERT INTO sale_items
        (id, sale_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot,
         quantity, unit_price_minor, line_total_minor)
        VALUES ('item-v1', 'sale-v1', 'variant-v1', 'Legacy Product', 'Default', 'LEGACY-1', 1, 200, 200);
      INSERT INTO payments
        (id, business_id, store_id, sale_id, method, amount_minor, status, created_at)
        VALUES ('payment-v1', 'business-v1', 'store-v1', 'sale-v1', 'cash', 200, 'confirmed', '2025-01-01');
      INSERT INTO app_settings (setting_key, setting_value)
        VALUES ('active_business_id', 'business-v1');
      PRAGMA user_version = 1;
    `)

    await migrateDatabase(database)
    await migrateDatabase(database)
    assert.equal((await database.getFirstAsync('PRAGMA user_version')).user_version, 12)
    assert.equal((await database.getFirstAsync('SELECT name FROM businesses WHERE id = ?', 'business-v1')).name, 'Existing Shop')
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM user_store_permissions')).count, 12)
    assert.equal((await getActiveWorkspace(database)).userId, 'owner-v1')
    assert.equal((await database.getFirstAsync(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'active_store_id'",
    )).setting_value, 'store-v1')
    assert.equal((await database.getFirstAsync(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'language'",
    )).setting_value, 'en')
    assert.deepEqual({ ...await database.getFirstAsync(
      'SELECT paid_minor AS paid, balance_due_minor AS due FROM sales WHERE id = ?',
      'sale-v1',
    ) }, { paid: 200, due: 0 })
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM sale_items WHERE sale_id = ?', 'sale-v1')).count, 1)
    assert.equal((await database.getFirstAsync('SELECT COUNT(*) AS count FROM payments WHERE sale_id = ?', 'sale-v1')).count, 1)
    assert.equal((await database.getFirstAsync(
      'SELECT amount_minor AS amount FROM cashbook_entries WHERE reference_id = ?',
      'sale-v1',
    )).amount, 200)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('selected language survives closing and reopening the SQLite database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-language-persistence-test-'))
  const databasePath = join(directory, 'shopflow.db')
  let database = openTestDatabase(databasePath)
  try {
    await migrateDatabase(database)
    await database.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('language', 'sw')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    )
    database.close()
    database = openTestDatabase(databasePath)
    await migrateDatabase(database)
    assert.equal((await database.getFirstAsync(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'language'",
    )).setting_value, 'sw')
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('remote business access activates a store-scoped local workspace', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopflow-remote-workspace-test-'))
  const database = openTestDatabase(join(directory, 'shopflow.db'))
  try {
    await migrateDatabase(database)
    const localWorkspace = await createWorkspace(database, {
      ownerName: 'Local Owner',
      ownerUsername: 'local-owner',
      ownerPassword: 'a-secure-local-password',
      businessName: 'Local Shop',
      storeName: 'Local Store',
    }, randomUUID)
    const user = {
      id: 'remote-user',
      full_name: 'Remote Cashier',
      email: 'cashier@example.com',
      phone: null,
      preferred_language: 'en',
      is_super_admin: false,
    }
    const access = {
      business_id: 'remote-business',
      business_name: 'Remote Shop',
      currency: 'TZS',
      role: 'cashier',
      store_ids: ['remote-store'],
      permissions: ['manage_sales', 'view_dashboard', 'manage_finance', 'manage_customers', 'manage_suppliers'],
      stores: [{
        id: 'remote-store',
        business_id: 'remote-business',
        name: 'Main Store',
        code: 'MAIN',
        address: null,
      }],
    }

    await activateRemoteWorkspace(database, user, access, 'remote-store')
    const workspace = await getActiveWorkspace(database)
    assert.equal(workspace.businessId, access.business_id)
    assert.equal(workspace.storeId, access.stores[0].id)
    assert.equal(workspace.userId, user.id)
    assert.equal((await database.getFirstAsync(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
    )).setting_value, 'online')
    await assertPermission(database, workspace, 'sell')
    await assertPermission(database, workspace, 'view_dashboard')
    await assertPermission(database, workspace, 'manage_finance')
    await assertPermission(database, workspace, 'manage_customers')
    await assertPermission(database, workspace, 'manage_suppliers')
    await assertAnyPermission(database, workspace, ['sell', 'manage_customers'])
    await assertAnyPermission(database, workspace, ['manage_inventory', 'manage_suppliers'])
    await assert.rejects(
      assertAnyPermission(database, workspace, ['manage_products', 'manage_inventory']),
      /do not have permission/,
    )
    await assert.rejects(
      assertPermission(database, workspace, 'manage_products'),
      /do not have permission/,
    )
    await assert.rejects(
      activateRemoteWorkspace(database, user, access, 'unassigned-store'),
      /no active store assigned/,
    )
    await restoreLocalWorkspace(database)
    assert.deepEqual({ ...await getActiveWorkspace(database) }, localWorkspace)
    assert.equal((await database.getFirstAsync(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
    )).setting_value, 'local')
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
