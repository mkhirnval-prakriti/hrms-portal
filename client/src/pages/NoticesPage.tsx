import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type Notice = {
  id: number
  title: string
  body: string
  created_at: string
  author_name?: string
  read_by_me?: number
}
type Reply = { id: number; user_name: string; body: string; created_at: string }

export function NoticesPage() {
  const { user } = useAuth()
  const canWrite = canPerm(user, 'notices:write')
  const [rows, setRows] = useState<Notice[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [replyByNotice, setReplyByNotice] = useState<Record<number, Reply[]>>({})
  const [replyText, setReplyText] = useState<Record<number, string>>({})

  async function load() {
    api<{ notices: Notice[] }>('/notices')
      .then((d) => setRows(d.notices || []))
      .catch((e) => setErr((e as Error).message))
  }
  useEffect(() => {
    load()
  }, [])

  async function postNotice(e: React.FormEvent) {
    e.preventDefault()
    await api('/notices', {
      method: 'POST',
      body: JSON.stringify({ title, body, visible_from: from || undefined, visible_until: until || undefined }),
    })
    setTitle('')
    setBody('')
    setFrom('')
    setUntil('')
    await load()
  }
  async function markRead(id: number) {
    await api(`/notices/${id}/read`, { method: 'POST' })
    await load()
  }
  async function loadReplies(id: number) {
    const d = await api<{ replies: Reply[] }>(`/notices/${id}/replies`)
    setReplyByNotice((prev) => ({ ...prev, [id]: d.replies || [] }))
  }
  async function postReply(id: number) {
    const text = (replyText[id] || '').trim()
    if (!text) return
    await api(`/notices/${id}/replies`, { method: 'POST', body: JSON.stringify({ body: text }) })
    setReplyText((prev) => ({ ...prev, [id]: '' }))
    await loadReplies(id)
  }

  return (
    <div className="mx-auto max-w-[800px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Notice board</h1>
      {canWrite && (
        <form onSubmit={postNotice} className="ph-card space-y-3 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Create notice</h2>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Title" className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Message" rows={3} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Publish</button>
        </form>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="space-y-4">
        {rows.map((n) => (
          <article key={n.id} className="ph-card rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#1f5e3b]">{n.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#14261a]">{n.body}</p>
            <p className="mt-3 text-xs text-[#1f5e3b]/55">
              {n.author_name} · {new Date(n.created_at).toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Number(n.read_by_me || 0) === 0 && (
                <button type="button" onClick={() => void markRead(n.id)} className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]">
                  Mark as read
                </button>
              )}
              <button type="button" onClick={() => void loadReplies(n.id)} className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]">
                View replies
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {(replyByNotice[n.id] || []).map((r) => (
                <p key={r.id} className="rounded-lg bg-[#f5faf6] px-3 py-2 text-xs">
                  <strong>{r.user_name}</strong>: {r.body}
                </p>
              ))}
              <div className="flex gap-2">
                <input value={replyText[n.id] || ''} onChange={(e) => setReplyText((prev) => ({ ...prev, [n.id]: e.target.value }))} placeholder="Reply..." className="flex-1 rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
                <button type="button" onClick={() => void postReply(n.id)} className="rounded-lg bg-[#1f5e3b] px-3 py-2 text-xs font-semibold text-white">Send</button>
              </div>
            </div>
          </article>
        ))}
        {rows.length === 0 && !err && <p className="text-sm text-[#1f5e3b]/60">No notices.</p>}
      </div>
    </div>
  )
}
