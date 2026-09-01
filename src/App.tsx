import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type EntryType = 'expense' | 'income'
type LedgerEntry = { id: string; date: string; name: string; amount: number; type: EntryType; createdAt: string }
const STORAGE_KEY = 'ivan-meal-ledger-v1'

const icons = {
  arrowDown: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v14m0 0 6-6m-6 6-6-6" /></svg>,
  arrowUp: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V6m0 0 6 6m-6-6-6 6" /></svg>,
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
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00:00`))
}

function dateColumnLabel(value: string) {
  return value.replaceAll('-', '/')
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LedgerEntry>
  return Boolean(typeof item.id === 'string' && typeof item.date === 'string' && typeof item.name === 'string' && typeof item.amount === 'number' && (item.type === 'expense' || item.type === 'income'))
}

function App() {
  const [entries, setEntries] = useState<LedgerEntry[]>(loadEntries)
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

  const visibleEntries = useMemo(() => [...entries].filter((entry) => filter === 'all' || entry.type === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [entries, filter])
  const amountPreview = useMemo(() => {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return type === 'expense' ? Math.round((parsed / 2) * 100) / 100 : Math.round(parsed * 100) / 100
  }, [amount, type])

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
    const recordedAmount = type === 'expense' ? parsedAmount / 2 : parsedAmount
    const next: LedgerEntry = { id: crypto.randomUUID(), date: todayISO(), name: name.trim(), amount: Math.round(recordedAmount * 100) / 100, type, createdAt: new Date().toISOString() }
    persist([...entries, next])
    setName(''); setAmount(''); setType('expense')
    showMessage(type === 'expense' ? `${dateLabel(next.date)} · 已按一半记录 ${money(next.amount)}` : `${dateLabel(next.date)} · 已充值 ${money(next.amount)}`)
  }

  function removeEntry(id: string) {
    if (window.confirm('删除这条记录？')) persist(entries.filter((entry) => entry.id !== id))
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
      <header className="topbar"><div><p className="eyebrow">IVAN'S MEAL FUND</p><h1>饭钱</h1></div><div className="privacy-dot" title="数据保存在当前设备"><span /> 本机保存</div></header>

      <section className={`balance-card ${totals.balance < 0 ? 'negative' : ''}`}>
        <p>当前余额</p><strong>{money(totals.balance)}</strong>
        <div className="summary-row">
          <div><span className="summary-icon expense">{icons.arrowDown}</span><span><small>累计花费</small>{money(totals.expense)}</span></div>
          <div><span className="summary-icon income">{icons.arrowUp}</span><span><small>累计充值</small>{money(totals.income)}</span></div>
        </div>
      </section>

      <section className="entry-card" aria-labelledby="add-title">
        <div className="section-heading">
          <div><p className="section-kicker">{dateLabel(todayISO())}</p><h2 id="add-title">记一笔</h2></div>
          <div className="type-switch" aria-label="收支类型"><button className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')} type="button">花费</button><button className={type === 'income' ? 'active income' : ''} onClick={() => setType('income')} type="button">充值</button></div>
        </div>
        <form onSubmit={addEntry}>
          <label><span>名称</span><input value={name} onChange={(event) => handleName(event.target.value)} placeholder="例如：午饭" autoComplete="off" /></label>
          <label><span>{type === 'expense' ? '消费总金额' : '充值金额'}</span><div className="money-input"><b>¥</b><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" inputMode="decimal" /></div></label>
          <button className="submit-button" type="submit">{icons.plus}<span>保存记录</span></button>
        </form>
        <div className="entry-notes">
          <p className="date-note">保存时自动固定今天的日期，无需选择。</p>
          {amountPreview !== null && <p className={`amount-preview ${type}`}><span>{type === 'expense' ? '两人平分，实际入账' : '实际入账'}</span><strong>{money(amountPreview)}</strong></p>}
        </div>
      </section>

      <section className="history-section" aria-labelledby="history-title">
        <div className="history-header"><div><p className="section-kicker">共 {entries.length} 笔</p><h2 id="history-title">记录</h2></div><div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'expense' ? 'active' : ''} onClick={() => setFilter('expense')}>花费</button><button className={filter === 'income' ? 'active' : ''} onClick={() => setFilter('income')}>充值</button></div></div>
        {visibleEntries.length ? <><div className="entry-columns" aria-hidden="true"><span>日期</span><span>名称</span><span>金额</span><span /></div><ol className="entry-list">{visibleEntries.map((entry) => <li key={entry.id}><div className={`entry-mark ${entry.type}`} /><time dateTime={entry.date}>{dateColumnLabel(entry.date)}</time><div className="entry-copy"><strong>{entry.name}</strong></div><b className={entry.type}>{entry.type === 'income' ? '+' : '−'}{money(entry.amount)}</b><button className="delete-button" onClick={() => removeEntry(entry.id)} aria-label={`删除 ${entry.name}`}>{icons.trash}</button></li>)}</ol></> : <div className="empty-state"><div className="empty-coin">¥</div><h3>{entries.length ? '没有符合条件的记录' : '从今天开始记饭钱'}</h3><p>{entries.length ? '切换上方筛选查看其他记录。' : '填写名称和金额，日期与余额会自动处理。'}</p></div>}
      </section>

      <section className="data-tools">
        <div><p className="section-kicker">数据管理</p><h2>备份与恢复</h2><p>记录只保存在这个浏览器。换设备前请先导出备份。</p></div>
        <div className="tool-buttons"><button onClick={exportBackup} disabled={!entries.length}>{icons.download}<span>导出备份</span></button><button onClick={() => fileInput.current?.click()}>{icons.upload}<span>导入备份</span></button><button className="danger" onClick={clearAll} disabled={!entries.length}>{icons.trash}<span>清空</span></button></div>
        <input ref={fileInput} type="file" accept="application/json,.json" onChange={importBackup} hidden />
      </section>

      <footer>不上传账目 · 不需要账号 · 可添加到主屏幕</footer>
      {message && <div className="toast" role="status">{message}</div>}
    </main>
  )
}

export default App
