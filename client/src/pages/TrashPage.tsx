import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type LogRow = {
  id: number
  action: string
  entity_type: string
  entity_id: string
  created_at: string
  actor_name?: string
}

type DeletedUser = {
  id: number
  full_name: string
  login_id?: string | null
  email: string
  mobile?: string | null
  role: string
  deleted_at: string
}

type Retention = {
  mode: 'days' | 'minutes'
  days: number
  minutes: number
}

export function TrashPage() {
  const { user } = useAuth()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [users, setUsers] = useState<DeletedUser[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [retention, setRetention] = useState<Retention>({ mode: 'days', days: 30, minutes: 30 })
  const [search, setSearch] = useState('')

  const canAudit = canPerm(user, 'audit:read')

  useEffect(() => {
    if (!canAudit) return
    Promise.all([
      api<{ logs: LogRow[] }>('/audit/logs?limit=200'),
      api<{ users: DeletedUser[] }>('/trash/users'),
      api<Retention>('/trash/retention'),
    ])
      .then(([lg, us, rt]) => {
        setLogs(lg.logs || [])
        setUsers(us.users || [])
        setRetention(rt)
      })
      .catch((e) => setErr((e as Error).message))
  }, [canAudit])

  async function restoreUser(id: number) {
    setErr(null)
    try {
      await api(`/trash/users/${id}/restore`, { method: 'POST' })
      setUsers((prev) => prev.filter((u) => u.id !== id))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function saveRetention() {
    setErr(null)
    try {
      const next = await api<Retention>('/trash/retention', {
        method: 'PATCH',
        body: JSON.stringify(retention),
      })
      setRetention(next)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const filteredUsers = users.filter((u) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${u.full_name} ${u.login_id || ''} ${u.email || ''} ${u.mobile || ''}`.toLowerCase().includes(q)
  })

  if (!canAudit) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center text-sm text-[#1f5e3b]">
        Audit history is restricted to Super Admin.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Trash & Audit</h1>
      <p className="text-sm text-[#1f5e3b]/70">Restore deleted staff and manage auto-delete retention.</p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="ph-card rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block font-semibold text-[#1f5e3b]">Mode</span>
            <select
              value={retention.mode}
              onChange={(e) => setRetention((p) => ({ ...p, mode: e.target.value as 'days' | 'minutes' }))}
              className="rounded-lg border border-[#1f5e3b]/15 px-2 py-1.5"
            >
              <option value="days">Days</option>
              <option value="minutes">Minutes</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-semibold text-[#1f5e3b]">Days</span>
            <input
              type="number"
              min={1}
              value={retention.days}
              onChange={(e) => setRetention((p) => ({ ...p, days: Number(e.target.value) || 30 }))}
              className="w-24 rounded-lg border border-[#1f5e3b]/15 px-2 py-1.5"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-semibold text-[#1f5e3b]">Minutes</span>
            <input
              type="number"
              min={1}
              value={retention.minutes}
              onChange={(e) => setRetention((p) => ({ ...p, minutes: Number(e.target.value) || 30 }))}
              className="w-24 rounded-lg border border-[#1f5e3b]/15 px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveRetention()}
            className="rounded-lg bg-[#1f5e3b] px-3 py-1.5 text-xs font-semibold text-white"
          >
            Save retention
          </button>
        </div>
      </div>
      <div className="ph-card max-h-[38vh] overflow-auto rounded-2xl p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1f5e3b]">Deleted staff</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name / id / mobile / email"
            className="rounded-xl border border-[#1f5e3b]/15 px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={() => setSearch('')}
            className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]"
          >
            Clear
          </button>
        </div>
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-[#1f5e3b]/10 text-[#1f5e3b]/80">
              <th className="py-2 pr-2">Name</th>
              <th className="py-2 pr-2">Emp ID</th>
              <th className="py-2 pr-2">Role</th>
              <th className="py-2 pr-2">Deleted At</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id} className="border-b border-[#1f5e3b]/5">
                <td className="py-2 pr-2">{u.full_name}</td>
                <td className="py-2 pr-2">{u.login_id || `#${u.id}`}</td>
                <td className="py-2 pr-2">{u.role}</td>
                <td className="py-2 pr-2">{u.deleted_at}</td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => void restoreUser(u.id)}
                    className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]"
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td className="py-3 text-[#1f5e3b]/60" colSpan={5}>
                  {search.trim() ? 'No deleted staff match your search.' : 'Trash is empty.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ph-card max-h-[70vh] overflow-auto rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-semibold text-[#1f5e3b]">Audit log</h2>
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-[#1f5e3b]/10 text-[#1f5e3b]/80">
              <th className="py-2 pr-2">Time</th>
              <th className="py-2 pr-2">Actor</th>
              <th className="py-2 pr-2">Action</th>
              <th className="py-2">Entity</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-[#1f5e3b]/5">
                <td className="py-2 pr-2 whitespace-nowrap">{l.created_at}</td>
                <td className="py-2 pr-2">{l.actor_name || '—'}</td>
                <td className="py-2 pr-2">{l.action}</td>
                <td className="py-2">
                  {l.entity_type} #{l.entity_id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
