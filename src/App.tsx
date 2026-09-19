import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type EntryType = 'expense' | 'income'
type LedgerEntry = { id: string; date: string; name: string; amount: number; type: EntryType; createdAt: string }
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

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LedgerEntry>
  return Boolean(typeof item.id === 'string' && typeof item.date === 'string' && typeof item.name === 'string' && typeof item.amount === 'number' && (item.type === 'expense' || item.type === 'income'))
}

function loadEntries(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLedgerEntry).map((entry, index) => ({
      ...entry,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : `${entry.date}T12:00:${String(index).padStart(2, '0')}`,
    }))
  } catch { return [] }
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)
}

function App() {
  const [entries, setEntries] = useState<LedgerEntry[]>(loadEntries)
  const [entryDate, setEntryDate] = useState(todayISO)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<EntryType>('expense')
  const [filter, setFilter] = useState<'all' | EntryType>('all')
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const totals = useMemo(() => entries.reduce((result, entry) => {
    if (entry.type === 'income') result.income += entry.amount
    else result.expense += entry.amount
    result.balance += entry.type === 'income' ? entry.amount : -entry.amount
    return result
  }, { income: 0, expense: 0, balance: 0 }), [entries])

  const rows = useMemo<LedgerRow[]>(() => {
    let balance = 0
    return [...entries]
      .sort((a, b) => (a.createdAt || a.date).localeCompare(b.createdAt || b.date))
      .map((entry) => {
        balance += entry.type === 'income' ? entry.amount : -entry.amount
        return { ...entry, balance }
      })
      .reverse()
  }, [entries])

  const visibleRows = useMemo(() => rows.filter((entry) => filter === 'all' || entry.type === filter), [rows, filter])
  const amountPreview = useMemo(() => {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.round(type === 'expense' ? parsed / 2 : parsed)
  }, [amount, type])
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
    const recordedAmount = Math.round(type === 'expense' ? parsedAmount / 2 : parsedAmount)
    const next: LedgerEntry = {
      id: crypto.randomUUID(),
      date: entryDate,
      name: name.trim(),
      amount: recordedAmount,
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
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2)
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
      persist(candidates); showMessage(`已导入 ${candidates.length} 条记录`)
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
                {type === 'expense' ? <><span>¥</span><input aria-label="花费总金额" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="总金额" inputMode="decimal" />{amountPreview !== null && <small>入账 {money(amountPreview)}</small>}</> : <button type="button" onClick={() => { setType('expense'); setAmount('') }}>＋ 记花费</button>}
              </div>
              <div className={`amount-cell ${type === 'income' ? 'active income' : ''}`}>
                {type === 'income' ? <><span>¥</span><input aria-label="充值金额" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="金额" inputMode="decimal" />{amountPreview !== null && <small>入账 {money(amountPreview)}</small>}</> : <button type="button" onClick={() => { setType('income'); setAmount('') }}>＋ 记充值</button>}
              </div>
              <div className={`balance-cell preview ${balancePreview < 0 ? 'negative' : ''}`}>{money(balancePreview)}</div>
              <button className="save-row" type="submit" aria-label="保存记录">{icons.plus}</button>
            </form>

            {visibleRows.length ? <div className="ledger-body">{visibleRows.map((entry) => (
              <div className="ledger-row" role="row" key={entry.id}>
                <label className="date-cell date-editor">
                  <span className="sr-only">修改 {entry.name} 的日期</span>
                  <input type="date" value={entry.date} onChange={(event) => updateEntryDate(entry.id, event.target.value)} required />
                </label>
                <div className="name-cell"><strong>{entry.name}</strong></div>
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
