import type { SQLiteDatabase } from 'expo-sqlite'
import { getLocalReport, getCashbookTotals } from '../repositories/cashbook.ts'
import type { Workspace } from '../repositories/workspace.ts'
import { getLocalInsights } from './insights.ts'
import { formatTzs } from '../domain/money.ts'
import type { Language } from '../i18n/translations.ts'

export async function answerBusinessQuestion(
  database: SQLiteDatabase,
  workspace: Workspace,
  question: string,
  language: Language,
): Promise<string> {
  const [insights, report, cashbook, sync] = await Promise.all([
    getLocalInsights(database, workspace),
    getLocalReport(database, workspace, 30),
    getCashbookTotals(database, workspace),
    database.getFirstAsync<{ pending: number; failed: number }>(
      `SELECT
         SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM outbox WHERE business_id = ?`,
      workspace.businessId,
    ),
  ])
  const text = question.trim().toLocaleLowerCase()
  const isSwahili = language === 'sw'
  const money = (amount: number) => formatTzs(amount, language)

  if (/(stock|stoo|bidhaa.*isha|isha.*bidhaa|low stock)/i.test(text)) {
    if (insights.lowStock.length === 0) {
      return isSwahili
        ? 'Hakuna bidhaa zilizo chini ya kiwango cha tahadhari kwenye taarifa za kifaa.'
        : 'No products are at or below their low-stock threshold in the records on this device.'
    }
    const list = insights.lowStock
      .map((item) => `${item.name}: ${item.available}/${item.threshold}`)
      .join(', ')
    return isSwahili
      ? `Bidhaa zenye stoo ndogo (zilizopo/kikomo): ${list}.`
      : `Low-stock products (available/threshold): ${list}.`
  }

  if (/(best|top|popular|sell.*most|fast|inayoongoza|maarufu)/i.test(text)) {
    if (!insights.topSeller) {
      return isSwahili
        ? 'Bado hakuna mauzo ya kutosha kwenye taarifa za siku 7 zilizopita.'
        : 'There are no recorded sales in the last 7 days to identify a top seller.'
    }
    return isSwahili
      ? `${insights.topSeller.name} ndiyo bidhaa inayoongoza kwa vipimo ${insights.topSeller.units} vilivyouzwa siku 7 zilizopita.`
      : `${insights.topSeller.name} is the top seller, with ${insights.topSeller.units} units recorded in the last 7 days.`
  }

  if (/(debt|debtor|creditor|payable|balance|deni|madeni|wadai|wadaiwa)/i.test(text)) {
    return isSwahili
      ? `Salio la madeni ya wateja ni ${money(report.customerDebtMinor)}; kiasi kinachodaiwa kwa wasambazaji ni ${money(report.supplierPayableMinor)}.`
      : `Recorded customer debt is ${money(report.customerDebtMinor)}; supplier payables are ${money(report.supplierPayableMinor)}.`
  }

  if (/(cash|cashbook|income|expense|fedha|mapato|matumizi)/i.test(text)) {
    return isSwahili
      ? `Kitabu cha fedha kina mapato ${money(cashbook.incomeMinor)} na matumizi ${money(cashbook.expenseMinor)}. Haya ni jumla ya taarifa zilizohifadhiwa kwenye kifaa.`
      : `The cashbook records ${money(cashbook.incomeMinor)} in income and ${money(cashbook.expenseMinor)} in expenses. These totals use records saved on this device.`
  }

  if (/(sync|synchronize|synchronise|upload|offline|kusawazisha|kusync)/i.test(text)) {
    return isSwahili
      ? `Taarifa ${Number(sync?.pending ?? 0)} zinasubiri kusawazishwa na ${Number(sync?.failed ?? 0)} zimeshindwa. Fungua ukurasa wa Mwanzo na ujaribu kusawazisha ukiwa mtandaoni.`
      : `${Number(sync?.pending ?? 0)} records are waiting to sync and ${Number(sync?.failed ?? 0)} have failed. Open Home and retry sync while online.`
  }

  if (/(sale|sales|today|mauzo|leo)/i.test(text)) {
    return isSwahili
      ? `Leo kuna mauzo ${insights.todayCount} yenye jumla ya ${money(insights.todayTotalMinor)} kwenye kifaa hiki.`
      : `Today, this device has ${insights.todayCount} recorded sales totaling ${money(insights.todayTotalMinor)}.`
  }

  return isSwahili
    ? 'Naweza kujibu kuhusu mauzo ya leo, stoo ndogo, bidhaa zinazoongoza, madeni, kitabu cha fedha au hali ya usawazishaji. Majibu hutumia taarifa za kifaa hiki pekee.'
    : 'I can answer about today’s sales, low stock, top sellers, debts, cashbook totals, or sync status. Answers use records on this device only.'
}
