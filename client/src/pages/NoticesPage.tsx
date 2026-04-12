import { useEffect, useState } from 'react'
import { api } from '../api'

type Notice = {
  id: number
  title: string
  body: string
  created_at: string
  author_name?: string
}

export function NoticesPage() {
  const [rows, setRows] = useState<Notice[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api<{ notices: Notice[] }>('/notices')
      .then((d) => setRows(d.notices || []))
      .catch((e) => setErr((e as Error).message))
  }, [])

  return (
    <div className="mx-auto max-w-[800px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Notice board</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="space-y-4">
        {rows.map((n) => (
          <article key={n.id} className="ph-card rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#1f5e3b]">{n.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#14261a]">{n.body}</p>
            <p className="mt-3 text-xs text-[#1f5e3b]/55">
              {n.author_name} · {new Date(n.created_at).toLocaleString()}
            </p>
          </article>
        ))}
        {rows.length === 0 && !err && <p className="text-sm text-[#1f5e3b]/60">No notices.</p>}
      </div>
    </div>
  )
}
