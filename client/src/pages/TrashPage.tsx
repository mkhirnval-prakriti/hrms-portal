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

export function TrashPage() {
  const { user } = useAuth()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  const canAudit = canPerm(user, 'audit:read')

  useEffect(() => {
    if (!canAudit) return
    api<{ logs: LogRow[] }>('/audit/logs?limit=200')
      .then((d) => setLogs(d.logs || []))
      .catch((e) => setErr((e as Error).message))
  }, [canAudit])

  if (!canAudit) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center text-sm text-[#1f5e3b]">
        Audit history is restricted to Super Admin.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Audit log</h1>
      <p className="text-sm text-[#1f5e3b]/70">Recent system actions (compliance trail).</p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="ph-card max-h-[70vh] overflow-auto rounded-2xl p-4">
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
