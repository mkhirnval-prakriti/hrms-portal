import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type LeaveRow = {
  id: number
  user_id: number
  start_date: string
  end_date: string
  reason: string
  final_status: string
  manager_review: string | null
  admin_review: string | null
  full_name?: string
}

export function LeavesPage() {
  const { user } = useAuth()
  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  const canApply = canPerm(user, 'leave:apply')
  const canMgr = canPerm(user, 'leave:approve_manager')
  const isSuper = user?.role === 'SUPER_ADMIN'

  async function load() {
    setErr(null)
    setLoading(true)
    try {
      const d = await api<{ leaves: LeaveRow[] }>('/leave')
      setLeaves(d.leaves || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function apply(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await api('/leave/apply', {
        method: 'POST',
        body: JSON.stringify({ start_date: start, end_date: end, reason }),
      })
      setReason('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function mgrApprove(id: number) {
    setErr(null)
    try {
      await api(`/leave/${id}/manager-approve`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment || null }),
      })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function mgrReject(id: number) {
    setErr(null)
    try {
      await api(`/leave/${id}/manager-reject`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment || 'Rejected' }),
      })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function adminApprove(id: number) {
    setErr(null)
    try {
      await api(`/leave/${id}/admin-approve`, { method: 'POST', body: JSON.stringify({ comment: comment || null }) })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function adminReject(id: number) {
    setErr(null)
    try {
      await api(`/leave/${id}/admin-reject`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment || 'Rejected' }),
      })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Leaves</h1>
        <p className="text-sm text-[#1f5e3b]/70">Apply and track approvals (manager → super admin).</p>
      </div>

      {canApply && (
        <form onSubmit={apply} className="ph-card space-y-4 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Apply for leave</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Start date *</span>
              <input
                required
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">End date *</span>
              <input
                required
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Reason *</span>
              <textarea
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button type="submit" className="rounded-xl bg-[#1f5e3b] px-5 py-2.5 text-sm font-semibold text-white">
            Submit request
          </button>
        </form>
      )}

      {(canMgr || isSuper) && (
        <div className="ph-card rounded-2xl p-6">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">Approval comment (optional)</span>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full max-w-md rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              placeholder="Note for employee"
            />
          </label>
        </div>
      )}

      <div className="ph-card rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Requests</h2>
          <button type="button" onClick={load} className="text-sm font-medium text-[#1f5e3b] underline">
            Refresh
          </button>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="mt-4 text-sm">Loading…</p>
        ) : (
          <div className="mt-4 space-y-4">
            {leaves.map((L) => (
              <div
                key={L.id}
                className="rounded-xl border border-[#1f5e3b]/10 bg-white/80 p-4 text-sm shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[#14261a]">
                      {L.full_name || `User #${L.user_id}`} · {L.start_date} → {L.end_date}
                    </p>
                    <p className="mt-1 text-[#14261a]/85">{L.reason}</p>
                    <p className="mt-2 text-xs text-[#1f5e3b]/75">
                      Status: <strong>{L.final_status}</strong>
                      {L.manager_review && ` · Manager: ${L.manager_review}`}
                      {L.admin_review && ` · Admin: ${L.admin_review}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canMgr && L.final_status === 'PENDING' && L.manager_review == null && (
                      <>
                        <button
                          type="button"
                          onClick={() => mgrApprove(L.id)}
                          className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Manager OK
                        </button>
                        <button
                          type="button"
                          onClick={() => mgrReject(L.id)}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                        >
                          Manager reject
                        </button>
                      </>
                    )}
                    {isSuper &&
                      L.final_status === 'PENDING' &&
                      L.manager_review === 'APPROVED' &&
                      L.admin_review == null && (
                        <>
                          <button
                            type="button"
                            onClick={() => adminApprove(L.id)}
                            className="rounded-lg bg-[#1f5e3b] px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Final approve
                          </button>
                          <button
                            type="button"
                            onClick={() => adminReject(L.id)}
                            className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                          >
                            Final reject
                          </button>
                        </>
                      )}
                  </div>
                </div>
              </div>
            ))}
            {leaves.length === 0 && <p className="text-sm text-[#1f5e3b]/60">No leave requests.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
