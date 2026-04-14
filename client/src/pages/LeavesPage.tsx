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
type LeaveMessage = {
  id: number
  leave_id: number
  author_id: number
  author_name: string
  author_role: string
  body: string
  created_at: string
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
  const [search, setSearch] = useState('')
  const [openThreadId, setOpenThreadId] = useState<number | null>(null)
  const [threads, setThreads] = useState<Record<number, LeaveMessage[]>>({})
  const [threadDraft, setThreadDraft] = useState<Record<number, string>>({})

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
      setStart('')
      setEnd('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function loadThread(leaveId: number) {
    const data = await api<{ messages: LeaveMessage[] }>(`/leave/${leaveId}/thread`)
    setThreads((prev) => ({ ...prev, [leaveId]: data.messages || [] }))
  }

  async function sendThreadMessage(leaveId: number) {
    const body = String(threadDraft[leaveId] || '').trim()
    if (!body) return
    setErr(null)
    try {
      await api(`/leave/${leaveId}/thread`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      setThreadDraft((prev) => ({ ...prev, [leaveId]: '' }))
      await loadThread(leaveId)
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

  const filteredLeaves = leaves.filter((L) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${L.full_name || ''} ${L.user_id} ${L.reason}`.toLowerCase().includes(q)
  })

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
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name / employee id / reason"
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-1.5 text-xs"
            />
            <button type="button" onClick={load} className="text-sm font-medium text-[#1f5e3b] underline">
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]"
            >
              Clear
            </button>
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="mt-4 text-sm">Loading…</p>
        ) : (
          <div className="mt-4 space-y-4">
            {filteredLeaves.map((L) => (
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
                    <button
                      type="button"
                      onClick={async () => {
                        if (openThreadId === L.id) {
                          setOpenThreadId(null)
                          return
                        }
                        setOpenThreadId(L.id)
                        await loadThread(L.id)
                      }}
                      className="rounded-lg border border-[#1f5e3b]/20 px-3 py-1.5 text-xs font-semibold text-[#1f5e3b]"
                    >
                      {openThreadId === L.id ? 'Hide thread' : 'Open thread'}
                    </button>
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
                {openThreadId === L.id && (
                  <div className="mt-4 rounded-xl border border-[#1f5e3b]/10 bg-[#f7fbf8] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#1f5e3b]/80">Conversation</p>
                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                      {(threads[L.id] || []).map((m) => (
                        <div
                          key={m.id}
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                            Number(m.author_id) === Number(user?.id)
                              ? 'ml-auto bg-[#1f5e3b] text-white'
                              : 'bg-white text-[#14261a] ring-1 ring-[#1f5e3b]/10'
                          }`}
                        >
                          <p className="font-semibold">
                            {m.author_name} · {m.author_role}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                          <p className="mt-1 opacity-80">{new Date(m.created_at).toLocaleString()}</p>
                        </div>
                      ))}
                      {(threads[L.id] || []).length === 0 && (
                        <p className="text-xs text-[#1f5e3b]/65">No messages yet. Start the discussion here.</p>
                      )}
                    </div>
                    {L.final_status === 'PENDING' ? (
                      <div className="mt-3 flex gap-2">
                        <input
                          value={threadDraft[L.id] || ''}
                          onChange={(e) => setThreadDraft((prev) => ({ ...prev, [L.id]: e.target.value }))}
                          placeholder="Type a reply..."
                          className="flex-1 rounded-lg border border-[#1f5e3b]/20 px-3 py-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => sendThreadMessage(L.id)}
                          className="rounded-lg bg-[#1f5e3b] px-3 py-2 text-xs font-semibold text-white"
                        >
                          Send
                        </button>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-[#1f5e3b]/65">Thread closed after final decision.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {filteredLeaves.length === 0 && (
              <p className="text-sm text-[#1f5e3b]/60">
                {search.trim() ? 'No leave requests match your search.' : 'No leave requests.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
