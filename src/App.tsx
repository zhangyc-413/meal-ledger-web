import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

import { BOC_SOURCE, isBocQuote, isQuoteStale, isLedgerEntry, normalizeEntries, recordedAmount } from './ledger'
import type { BocQuote, Currency, EntryType, LedgerEntry } from './ledger'
type LedgerRow = LedgerEntry & { balance: number }

const STORAGE_KEY = 'ivan-meal-ledger-v1'

const icons = {
  calendar: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" /></svg>,
  hash: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-2 18M17 3l-2 18M4 9h16M3 15h16" /></svg>,
  download: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v2h14v-2" /></svg>,
  upload: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0 4 4m-4-4-4 4M5 18v2h14v-2" /></svg>,
  trash: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>,
  plus: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
}

function todayISO() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function loadEntries(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return normalizeEntries(parsed.filter(isLedgerEntry))
  } catch { return [] }
}

function money(value: number, currency: Currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)
}

const QUOTE_KEY = 'ivan-meal-ledger-boc-hkd'
function loadQuote(): BocQuote | null {
  try {
    const cached = JSON.parse(localStorage.getItem(QUOTE_KEY) || 'null')
    return isBocQuote(cached) ? cached : null
  } catch { return null }
}
function quoteTime(quote: BocQuote) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(quote.publishedAt))
}

function App() {
  const [entries, setEntries] = useState<LedgerEntry[]>(loadEntries)
  const [entryDate, setEntryDate] = useState(todayISO)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<EntryType>('expense')
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [quote, setQuote] = useState<BocQuote | null>(loadQuote)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateError, setRateError] = useState(false)
  const [acceptOldRate, setAcceptOldRate] = useState(false)
  const [filter, setFilter] = useState<'all' | EntryType>('all')
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const staleRate = quote ? isQuoteStale(quote) : false
  const canSave = currency === 'CNY' || (quote !== null && (!staleRate || acceptOldRate))

  async function refreshQuote() {
    setRateLoading(true)
    setRateError(false)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}boc-hkd.json`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error('Rate unavailable')
      const value: unknown = await response.json()
      if (!isBocQuote(value)) throw new Error('Invalid rate')
      // Never replace a newer cached quote with an older deployment snapshot.
      const cached = loadQuote()
      const latest = cached && Date.parse(cached.publishedAt) > Date.parse(value.publishedAt) ? cached : value
      setQuote(latest)
      setAcceptOldRate(false)
      try { localStorage.setItem(QUOTE_KEY, JSON.stringify(latest)) } catch { /* still usable in memory */ }
    } catch { setRateError(true) }
    finally { setRateLoading(false) }
  }

  useEffect(() => {
    void refreshQuote()
    const onFocus = () => { void refreshQuote() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const totals = useMemo(() => entries.reduce((result, entry) => {
    if (entry.type === 'income') result.income += entry.amount
    else result.expense += entry.amount
    result.balance += entry.type === 'income' ? entry.amount : -entry.amount
    return result
  }, { income: 0, expense: 0, balance: 0 }), [entries])

  const rows = useMemo<LedgerRow[]>(() => {
    return [...entries]
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .reduce<LedgerRow[]>((result, entry) => {
        const previousBalance = result.at(-1)?.balance ?? 0
        const balance = previousBalance + (entry.type === 'income' ? entry.amount : -entry.amount)
        result.push({ ...entry, balance })
        return result
      }, [])
      .reverse()
  }, [entries])

  const visibleRows = useMemo(() => rows.filter((entry) => filter === 'all' || entry.type === filter), [rows, filter])
  const amountPreview = useMemo(() => {
    return recordedAmount(Number(amount), type, currency, quote)
  }, [amount, type, currency, quote])
  const balancePreview = totals.balance + (amountPreview === null ? 0 : type === 'income' ? amountPreview : -amountPreview)

  function persist(next: LedgerEntry[]) {
    setEntries(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function handleName(value: string) {
    setName(value)
    if (/^(充值|存|转入|收入)/.test(value.trim())) setType('income')
  }

  function showMessage(text: string) {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 2400)
  }

  function addEntry(event: FormEvent) {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!name.trim()) return showMessage('请填写名称')
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return showMessage('请输入正确的金额')
    if (!canSave) return showMessage('请先获取汇率或确认使用旧牌价')
    const convertedAmount = recordedAmount(parsedAmount, type, currency, quote)
    if (convertedAmount === null) return showMessage('金额过大或汇率不可用')
    const next: LedgerEntry = {
      id: crypto.randomUUID(),
      date: entryDate,
      name: name.trim(),
      amount: convertedAmount,
      currency,
      originalAmount: parsedAmount,
      ...(currency === 'HKD' && quote ? { exchangeRate: { ...quote } } : {}),
      type,
      createdAt: new Date().toISOString(),
    }
    persist([...entries, next])
    setName(''); setAmount(''); setType('expense')
    showMessage(type === 'expense' ? `已自动平分，扣除 ${money(next.amount)}` : `已充值 ${money(next.amount)}`)
  }

  function removeEntry(id: string) {
    if (window.confirm('删除这条记录？')) persist(entries.filter((entry) => entry.id !== id))
  }

  function updateEntryDate(id: string, date: string) {
    if (!date) return
    persist(entries.map((entry) => entry.id === id ? { ...entry, date } : entry))
    showMessage('日期已更新')
  }

  function exportBackup() {
    const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), entries }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `饭钱备份-${todayISO()}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const candidates = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.records)
      if (!Array.isArray(candidates) || !candidates.every(isLedgerEntry)) throw new Error('invalid')
      if (entries.length && !window.confirm('导入会替换当前设备中的记录，继续吗？')) return
      persist(normalizeEntries(candidates)); showMessage(`已导入 ${candidates.length} 条记录`)
    } catch { showMessage('备份文件无法识别') }
    finally { event.target.value = '' }
  }

  function clearAll() {
    if (entries.length && window.confirm('确定清空当前设备的全部记录？请先导出备份。')) persist([])
  }

  return (
    <main className="app-shell">
      <header className="page-header"><h1>饭钱账本</h1></header>

      <section className="summary-strip" aria-label="账本汇总">
        <div className="balance-summary"><span>当前余额</span><strong className={totals.balance < 0 ? 'negative' : ''}>{money(totals.balance)}</strong></div>
        <div><span>累计花费</span><strong>{money(totals.expense)}</strong></div>
        <div><span>累计充值</span><strong>{money(totals.income)}</strong></div>
        <div><span>记录数量</span><strong>{entries.length} 笔</strong></div>
      </section>

      <section className="database-section" aria-labelledby="database-title">
        <div className="database-toolbar">
          <div><p className="view-label">Table</p><h2 id="database-title">全部记录</h2></div>
          <div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'expense' ? 'active' : ''} onClick={() => setFilter('expense')}>花费</button><button className={filter === 'income' ? 'active' : ''} onClick={() => setFilter('income')}>充值</button></div>
        </div>

        <div className="currency-panel">
          <div className="currency-switch" role="group" aria-label="本笔币种">
            <button type="button" aria-pressed={currency === 'CNY'} onClick={() => { setCurrency('CNY'); setAcceptOldRate(false) }}>人民币</button>
            <button type="button" aria-pressed={currency === 'HKD'} onClick={() => { setCurrency('HKD'); setAcceptOldRate(false) }}>港币</button>
          </div>
          {currency === 'HKD' && <div className="currency-detail" aria-live="polite">
            <p>
              {quote && <strong title={`牌价：${quoteTime(quote)}（北京时间）；按记账时牌价折算，已记账金额不变。`}>1 港币 = ¥{quote.rate.toFixed(4)}</strong>}
              <a href={BOC_SOURCE} target="_blank" rel="noreferrer" title="中国银行（中国内地）现汇买入价">中行买入价</a>
              <button type="button" aria-label="刷新汇率" title="刷新汇率" onClick={() => void refreshQuote()} disabled={rateLoading}>↻</button>
            </p>
            {!quote && <p className="rate-warning">{rateLoading ? '读取汇率中…' : '汇率读取失败，请重试'}</p>}
            {quote && rateError && !staleRate && <p className="rate-warning">暂用上次牌价</p>}
            {quote && staleRate && <label className="rate-warning stale-confirm"><input type="checkbox" checked={acceptOldRate} onChange={(event) => setAcceptOldRate(event.target.checked)} />使用旧牌价（{quoteTime(quote)}）</label>}
          </div>}
        </div>

        <p className="mobile-hint">表格可以左右滑动查看完整内容</p>
        <div className="table-scroll">
          <div className="ledger-table" role="table" aria-label="饭钱记录">
            <div className="ledger-head" role="row">
              <span role="columnheader">{icons.calendar} Date</span>
              <span role="columnheader">Name</span>
              <span role="columnheader">{icons.hash} 花费</span>
              <span role="columnheader">{icons.hash} 充值</span>
              <span role="columnheader">{icons.hash} 余额</span>
              <span aria-hidden="true" />
            </div>

            <form className="ledger-new-row" onSubmit={addEntry} aria-label="新增记录">
              <label className="date-cell date-editor new-date-editor">
                <span className="sr-only">记录日期</span>
                {icons.calendar}
                <input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required />
              </label>
              <label className="name-cell"><span className="sr-only">名称</span><input value={name} onChange={(event) => handleName(event.target.value)} placeholder="输入名称" autoComplete="off" /></label>
              <div className={`amount-cell ${type === 'expense' ? 'active expense' : ''}`}>
                {type === 'expense' ? <><span>{currency === 'HKD' ? 'HK$' : '¥'}</span><input aria-label="花费总金额" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="总金额" inputMode="decimal" />{amountPreview !== null && <small>入账 {money(amountPreview)}</small>}</> : <button type="button" onClick={() => { setType('expense'); setAmount('') }}>＋ 记花费</button>}
              </div>
              <div className={`amount-cell ${type === 'income' ? 'active income' : ''}`}>
                {type === 'income' ? <><span>{currency === 'HKD' ? 'HK$' : '¥'}</span><input aria-label="充值金额" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="金额" inputMode="decimal" />{amountPreview !== null && <small>入账 {money(amountPreview)}</small>}</> : <button type="button" onClick={() => { setType('income'); setAmount('') }}>＋ 记充值</button>}
              </div>
              <div className={`balance-cell preview ${balancePreview < 0 ? 'negative' : ''}`}>{money(balancePreview)}</div>
              <button className="save-row" type="submit" disabled={!canSave} aria-label="保存记录">{icons.plus}</button>
            </form>

            {visibleRows.length ? <div className="ledger-body">{visibleRows.map((entry) => (
              <div className="ledger-row" role="row" key={entry.id}>
                <label className="date-cell date-editor">
                  <span className="sr-only">修改 {entry.name} 的日期</span>
                  <input type="date" value={entry.date} onChange={(event) => updateEntryDate(entry.id, event.target.value)} required />
                </label>
                <div className="name-cell saved-name"><strong>{entry.name}</strong>{entry.currency === 'HKD' && entry.exchangeRate && <>
                  <small title={`中行现汇买入价 ${entry.exchangeRate.rate.toFixed(4)} · ${quoteTime(entry.exchangeRate)}`}>{entry.type === 'expense' ? '总额 ' : ''}{money(entry.originalAmount!, 'HKD')}</small>
                </>}</div>
                <div className="number-cell expense">{entry.type === 'expense' ? money(entry.amount) : ''}</div>
                <div className="number-cell income">{entry.type === 'income' ? money(entry.amount) : ''}</div>
                <div className={`balance-cell ${entry.balance < 0 ? 'negative' : ''}`}>{money(entry.balance)}</div>
                <button className="delete-button" onClick={() => removeEntry(entry.id)} aria-label={`删除 ${entry.name}`}>{icons.trash}</button>
              </div>
            ))}</div> : <div className="empty-row">没有符合条件的记录</div>}
          </div>
        </div>
      </section>

      <section className="data-tools">
        <div><p className="eyebrow">数据管理</p><h2>备份与恢复</h2><p>记录只保存在这个浏览器。换设备前请先导出备份。</p></div>
        <div className="tool-buttons"><button onClick={exportBackup} disabled={!entries.length}>{icons.download}<span>导出备份</span></button><button onClick={() => fileInput.current?.click()}>{icons.upload}<span>导入备份</span></button><button className="danger" onClick={clearAll} disabled={!entries.length}>{icons.trash}<span>清空</span></button></div>
        <input ref={fileInput} type="file" accept="application/json,.json" onChange={importBackup} hidden />
      </section>

      <footer>日期可调整 · 自动平分花费 · 自动计算余额</footer>
      {message && <div className="toast" role="status">{message}</div>}
    </main>
  )
}

export default App
