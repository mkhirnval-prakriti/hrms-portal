import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { currentPeriod } from '../lib/date'

type Entry = {
  id: number
  user_id: number
  period: string
  gross_inr: number
  deductions_inr: number
  net_inr: number
  notes: string | null
  full_name?: string
  email?: string
}

type UserMini = { id: number; full_name: string; email: string }

type PayrollOverview = {
  period: string
  totals: { gross_inr: number; deductions_inr: number; net_inr: number; count: number }
  entries: Entry[]
}

export function PayrollPage() {
  const { user } = useAuth()
  const [period, setPeriod] = useState(currentPeriod)
  const [overview, setOverview] = useState<PayrollOverview | null>(null)
  const [users, setUsers] = useState<UserMini[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const canRead = canPerm(user, 'payroll:read') || canPerm(user, 'payroll:read_self')
  const canWrite = canPerm(user, 'payroll:write')

  const [uid, setUid] = useState<number | ''>('')
  const [gross, setGross] = useState('')
  const [ded, setDed] = useState('')
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    if (!canRead) return
    setErr(null)
    setLoading(true)
    try {
      const d = await api<PayrollOverview>('/payroll/overview?period=' + encodeURIComponent(period))
      setOverview(d)
      if (canWrite) {
        const u = await api<{ users: UserMini[] }>('/users')
        setUsers(u.users || [])
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [canRead, canWrite, period])

  useEffect(() => {
    load()
  }, [load])

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite || uid === '') return
    setErr(null)
    try {
      await api('/payroll/entries', {
        method: 'POST',
        body: JSON.stringify({
          user_id: Number(uid),
          period,
          gross_inr: Number(gross) || 0,
          deductions_inr: Number(ded) || 0,
          notes: notes || null,
        }),
      })
      setGross('')
      setDed('')
      setNotes('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const inr = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)

  if (!canRead) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center">
        <p className="text-[#1f5e3b]">You do not have permission to view payroll.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Payroll</h1>
        <p className="text-sm text-[#1f5e3b]/70">Monthly totals and per-employee entries (stored in SQLite).</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-[#1f5e3b]">Period (YYYY-MM)</span>
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value.slice(0, 7))}
            className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            placeholder="2026-04"
          />
        </label>
        <button type="button" onClick={load} className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white">
          Load
        </button>
      </div>

      {canWrite && (
        <form onSubmit={saveEntry} className="ph-card space-y-4 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Add / update entry</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Employee</span>
              <select
                required
                value={uid}
                onChange={(e) => setUid(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.email})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Gross (INR)</span>
              <input
                value={gross}
                onChange={(e) => setGross(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
                inputMode="decimal"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Deductions (INR)</span>
              <input
                value={ded}
                onChange={(e) => setDed(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
                inputMode="decimal"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button type="submit" className="rounded-xl bg-[#1f5e3b] px-5 py-2.5 text-sm font-semibold text-white">
            Save entry
          </button>
        </form>
      )}

      <div className="ph-card rounded-2xl p-6">
        {err && <p className="text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="text-sm">Loading…</p>
        ) : overview ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-[#e8f5e9] p-4">
                <p className="text-xs font-medium text-[#1f5e3b]/80">Gross</p>
                <p className="text-xl font-bold text-[#1f5e3b]">{inr(overview.totals.gross_inr)}</p>
              </div>
              <div className="rounded-xl bg-[#fff3e0] p-4">
                <p className="text-xs font-medium text-[#8d6e63]">Deductions</p>
                <p className="text-xl font-bold text-[#5d4037]">{inr(overview.totals.deductions_inr)}</p>
              </div>
              <div className="rounded-xl bg-[#e3f2fd] p-4">
                <p className="text-xs font-medium text-[#1565c0]">Net</p>
                <p className="text-xl font-bold text-[#0d47a1]">{inr(overview.totals.net_inr)}</p>
              </div>
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#1f5e3b]/10">
                    <th className="py-2">Name</th>
                    <th className="py-2">Gross</th>
                    <th className="py-2">Deductions</th>
                    <th className="py-2">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.entries.map((e) => (
                    <tr key={e.id} className="border-b border-[#1f5e3b]/5">
                      <td className="py-2">{e.full_name || e.user_id}</td>
                      <td className="py-2">{inr(e.gross_inr)}</td>
                      <td className="py-2">{inr(e.deductions_inr)}</td>
                      <td className="py-2 font-semibold">{inr(e.net_inr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {overview.entries.length === 0 && (
                <p className="mt-4 text-sm text-[#1f5e3b]/60">No payroll rows for this period yet.</p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
