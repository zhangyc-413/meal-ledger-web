export type EntryType = 'expense' | 'income'
export type Currency = 'CNY' | 'HKD'
export const BOC_SOURCE = 'https://www.boc.cn/sourcedb/whpj/'
export type BocQuote = {
  currency: 'HKD'
  kind: 'spot-buy'
  source: typeof BOC_SOURCE
  rate: number
  publishedAt: string
  fetchedAt: string
}
export type LedgerEntry = {
  id: string; date: string; name: string; amount: number; type: EntryType; createdAt: string
  currency?: Currency; originalAmount?: number; exchangeRate?: BocQuote
}

export function isBocQuote(value: unknown): value is BocQuote {
  if (!value || typeof value !== 'object') return false
  const quote = value as Partial<BocQuote>
  return quote.currency === 'HKD' && quote.kind === 'spot-buy' && quote.source === BOC_SOURCE
    && typeof quote.rate === 'number' && Number.isFinite(quote.rate) && quote.rate > 0.1 && quote.rate < 2
    && typeof quote.publishedAt === 'string' && Number.isFinite(Date.parse(quote.publishedAt))
    && typeof quote.fetchedAt === 'string' && Number.isFinite(Date.parse(quote.fetchedAt))
}

export function isQuoteStale(quote: BocQuote, now = Date.now()) {
  const age = now - Date.parse(quote.publishedAt)
  return age > 48 * 60 * 60 * 1000 || age < -5 * 60 * 1000
}

export function recordedAmount(original: number, type: EntryType, currency: Currency, quote: BocQuote | null) {
  if (!Number.isFinite(original) || original <= 0 || original > 1e12) return null
  if (currency === 'HKD' && !isBocQuote(quote)) return null
  const rate = currency === 'HKD' ? quote!.rate : 1
  // Convert before splitting; keep the ledger's existing whole-yuan rounding rule.
  return Math.round(original * rate / (type === 'expense' ? 2 : 1))
}

export function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LedgerEntry>
  if (!(typeof item.id === 'string' && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    && typeof item.name === 'string' && typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount >= 0 && item.amount <= 2e12
    && (item.type === 'expense' || item.type === 'income'))) return false
  if (item.currency !== undefined && item.currency !== 'CNY' && item.currency !== 'HKD') return false
  if (item.currency === 'HKD') {
    return typeof item.originalAmount === 'number' && isBocQuote(item.exchangeRate)
      && recordedAmount(item.originalAmount, item.type, 'HKD', item.exchangeRate) === item.amount
  }
  return true
}

export function normalizeEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : `${entry.date}T12:00:00.000Z-${String(index).padStart(8, '0')}`,
  }))
}
