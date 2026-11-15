import assert from 'node:assert/strict'
import test from 'node:test'
import { BOC_SOURCE, isBocQuote, isLedgerEntry, isQuoteStale, normalizeEntries, recordedAmount } from '../src/ledger.ts'
import { parseBocQuote } from '../scripts/update-boc-rate.mjs'

const quote = { currency: 'HKD', kind: 'spot-buy', source: BOC_SOURCE, rate: 0.8489, publishedAt: '2026-11-15T10:30:00+08:00', fetchedAt: '2026-11-15T03:00:00Z' }
const oldEntry = { id: 'legacy', date: '2026-09-01', name: '午餐', amount: 43, type: 'expense' }
const hkdEntry = { ...oldEntry, currency: 'HKD', originalAmount: 200, amount: 85, exchangeRate: quote }

test('HKD converts before splitting and rounding, while income is not split', () => {
  assert.equal(recordedAmount(100, 'expense', 'HKD', quote), 42)
  assert.equal(recordedAmount(200, 'expense', 'HKD', quote), 85)
  assert.equal(recordedAmount(100, 'income', 'HKD', quote), 85)
  assert.equal(recordedAmount(1000, 'income', 'HKD', quote), 849)
  assert.equal(recordedAmount(85, 'expense', 'CNY', null), 43)
  assert.equal(recordedAmount(85.4, 'income', 'CNY', null), 85)
})
test('unavailable or invalid rate never treats HKD as CNY', () => {
  for (const value of [null, { ...quote, rate: 0 }, { ...quote, rate: NaN }, { ...quote, kind: 'spot-sell' }, { ...quote, source: 'https://example.com' }]) {
    assert.equal(recordedAmount(100, 'expense', 'HKD', value), null)
  }
  for (const amount of [0, -1, Infinity, NaN, 1e13]) assert.equal(recordedAmount(amount, 'expense', 'CNY', null), null)
})
test('legacy records retain amounts and get sortable creation times', () => {
  assert.equal(isLedgerEntry(oldEntry), true)
  const entries = normalizeEntries([oldEntry, { ...oldEntry, id: 'second' }])
  assert.equal(entries[0].amount, 43)
  assert.ok(entries[0].createdAt < entries[1].createdAt)
  assert.equal(entries[0].currency, undefined)
})
test('backup roundtrip preserves original HKD and a locked quote', () => {
  const restored = JSON.parse(JSON.stringify(hkdEntry))
  assert.equal(isLedgerEntry(restored), true)
  const newerQuote = { ...quote, rate: 0.9 }
  assert.equal(recordedAmount(200, 'expense', 'HKD', newerQuote), 90)
  assert.equal(restored.amount, 85)
  assert.equal(restored.exchangeRate.rate, 0.8489)
  assert.equal(isLedgerEntry({ ...hkdEntry, amount: 90 }), false)
  assert.equal(isLedgerEntry({ ...hkdEntry, exchangeRate: undefined }), false)
  assert.equal(isLedgerEntry({ ...oldEntry, amount: Infinity }), false)
})
test('stale and future quotes require acknowledgement', () => {
  assert.equal(isQuoteStale(quote, Date.parse('2026-11-16T02:30:00Z')), false)
  assert.equal(isQuoteStale(quote, Date.parse('2026-11-18T02:30:00Z')), true)
  assert.equal(isQuoteStale(quote, Date.parse('2026-11-14T02:30:00Z')), true)
  assert.equal(isBocQuote({ ...quote, publishedAt: 'invalid' }), false)
})
const html = `<table><tr><th>货币名称</th><th>现汇买入价</th><th>现钞买入价</th><th>现汇卖出价</th><th>现钞卖出价</th><th>中行折算价</th><th>发布日期</th><th>发布时间</th></tr>
<tr><td>港币</td><td>84.89</td><td>83.11</td><td>85.23</td><td>86.00</td><td>85.6</td><td class="pjrq">2026/11/15 10:30:00</td><td>10:30:00</td></tr></table>`
test('BOC parser uses spot buy per 100 HKD, with China publication time', () => {
  assert.deepEqual(parseBocQuote(html, quote.fetchedAt), quote)
  assert.equal(parseBocQuote(html.replace('2026/11/15 10:30:00', '2026.11.15').replace('2026.11.15', '2026-11-15')).publishedAt, quote.publishedAt)
})
test('BOC table changes or missing values fail closed', () => {
  for (const broken of [html.replace('84.89', ''), html.replace('港币', '美元'), html.replace('84.89', 'N/A'), html.replace('现汇买入价', '现汇卖出价'), html.replace('2026/11/15 10:30:00', 'missing')]) {
    assert.throws(() => parseBocQuote(broken))
  }
})
