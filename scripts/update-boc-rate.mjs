import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const SOURCE = 'https://www.boc.cn/sourcedb/whpj/'
export function parseBocQuote(html, fetchedAt = new Date().toISOString()) {
  const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi)?.find((value) => value.includes('现汇买入价') && value.includes('港币'))
  if (!table) throw new Error('BOC currency table missing')
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  const cells = rows.map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((cell) => cell[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()))
  const header = cells.find((row) => row.includes('现汇买入价'))
  const row = cells.find((row) => row[0] === '港币')
  if (!row || !header || header[1] !== '现汇买入价') throw new Error('BOC spot-buy column missing')
  const perHundred = Number(row[1])
  if (!/^\d+(\.\d+)?$/.test(row[1]) || !Number.isFinite(perHundred) || perHundred <= 10 || perHundred >= 200) throw new Error('Invalid HKD rate')
  const date = row[6].match(/^(\d{4})[-/](\d{2})[-/](\d{2})/)
  const time = row[6].match(/\d{2}:\d{2}:\d{2}/)?.[0] || row[7]
  if (!date || !/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new Error('BOC publication time missing')
  const publishedAt = `${date[1]}-${date[2]}-${date[3]}T${time}+08:00`
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('Invalid BOC publication time')
  return { currency: 'HKD', kind: 'spot-buy', source: SOURCE, rate: perHundred / 100, publishedAt, fetchedAt }
}

async function update() {
  const target = new URL('../public/boc-hkd.json', import.meta.url)
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!response.ok) throw new Error(`BOC HTTP ${response.status}`)
      const quote = parseBocQuote(await response.text())
      const age = Date.now() - Date.parse(quote.publishedAt)
      if (age < -300_000 || age > 48 * 60 * 60 * 1000) throw new Error('BOC quote is not current')
      await mkdir(new URL('../public/', import.meta.url), { recursive: true })
      await writeFile(target, JSON.stringify(quote, null, 2) + '\n')
      console.log(`BOC HKD spot-buy: ${quote.rate} CNY/HKD (${quote.publishedAt})`)
      return
    } catch (error) { lastError = error }
  }
  // Preserve the already-published quote when BOC is unreachable. Its timestamp stays intact.
  try {
    const previous = JSON.parse(await readFile(target, 'utf8'))
    if (previous.source !== SOURCE || previous.kind !== 'spot-buy' || !(previous.rate > 0.1 && previous.rate < 2)
      || !Number.isFinite(Date.parse(previous.publishedAt))) throw new Error('Invalid fallback')
    console.warn(`BOC refresh failed; retaining dated quote ${previous.publishedAt}: ${lastError.message}`)
  } catch { throw lastError }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await update()
