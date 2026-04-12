import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { localDateStr } from '../lib/date'

type AttRow = {
  id: number
  user_id: number
  work_date: string
  punch_in_at: string | null
  punch_out_at: string | null
  status: string
  full_name?: string
}

export function AttendancePage() {
  const { user } = useAuth()
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 14)
    return localDateStr(d)
  })
  const [to, setTo] = useState(() => localDateStr())
  const [records, setRecords] = useState<AttRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [punchMsg, setPunchMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const today = localDateStr()
  const canAll = canPerm(user, 'history:read')

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      const data = await api<{ records: AttRow[] }>('/attendance/history' + q)
      setRecords(data.records || [])
    } catch (e) {
      setErr((e as Error).message)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const todayRows = records.filter((r) => r.work_date === today)
  const myToday = todayRows.find((r) => r.user_id === user?.id)

  async function punch(kind: 'in' | 'out', useOffice: boolean) {
    setPunchMsg(null)
    setBusy(true)
    try {
      const path = kind === 'in' ? '/attendance/checkin' : '/attendance/checkout'
      const body: Record<string, unknown> = { source: 'device' }
      if (useOffice) {
        body.useBranchCenter = true
      } else {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000 })
        })
        body.lat = pos.coords.latitude
        body.lng = pos.coords.longitude
      }
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      setPunchMsg(kind === 'in' ? 'Checked in successfully.' : 'Checked out successfully.')
      await load()
    } catch (e) {
      setPunchMsg((e as Error).message || 'Punch failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Attendance</h1>
        <p className="text-sm text-[#1f5e3b]/70">Punch in/out and view history ({canAll ? 'team' : 'your'} records).</p>
      </div>

      <div className="ph-card rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Today · {today}</h2>
        {myToday && (
          <p className="mt-2 text-sm text-[#14261a]">
            Status: <span className="font-semibold capitalize">{myToday.status}</span>
            {myToday.punch_in_at && (
              <span className="ml-2 text-[#1f5e3b]/80">In: {new Date(myToday.punch_in_at).toLocaleString()}</span>
            )}
            {myToday.punch_out_at && (
              <span className="ml-2 text-[#1f5e3b]/80">Out: {new Date(myToday.punch_out_at).toLocaleString()}</span>
            )}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => punch('in', false)}
            className="rounded-xl bg-gradient-to-r from-[#1f5e3b] to-[#2e7d32] px-5 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50"
          >
            Check in (GPS)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => punch('out', false)}
            className="rounded-xl border border-[#1f5e3b]/25 bg-white px-5 py-2.5 text-sm font-semibold text-[#1f5e3b] shadow-sm disabled:opacity-50"
          >
            Check out (GPS)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => punch('in', true)}
            className="rounded-xl bg-[#66bb6a]/20 px-5 py-2.5 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
          >
            Check in (office location)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => punch('out', true)}
            className="rounded-xl bg-[#66bb6a]/20 px-5 py-2.5 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
          >
            Check out (office location)
          </button>
        </div>
        {punchMsg && <p className="mt-3 text-sm text-[#14261a]">{punchMsg}</p>}
      </div>

      <div className="ph-card rounded-2xl p-6">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={load}
            className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white"
          >
            Refresh
          </button>
        </div>
        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="mt-4 text-sm text-[#1f5e3b]/70">Loading…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#1f5e3b]/10 text-[#1f5e3b]/80">
                  <th className="py-2 pr-3">Date</th>
                  {canAll && <th className="py-2 pr-3">Employee</th>}
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">In</th>
                  <th className="py-2">Out</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-[#1f5e3b]/5">
                    <td className="py-2 pr-3">{r.work_date}</td>
                    {canAll && <td className="py-2 pr-3">{r.full_name || '—'}</td>}
                    <td className="py-2 pr-3 capitalize">{r.status}</td>
                    <td className="py-2 pr-3 text-xs text-[#14261a]/80">
                      {r.punch_in_at ? new Date(r.punch_in_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 text-xs text-[#14261a]/80">
                      {r.punch_out_at ? new Date(r.punch_out_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && <p className="mt-4 text-sm text-[#1f5e3b]/60">No records in range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
