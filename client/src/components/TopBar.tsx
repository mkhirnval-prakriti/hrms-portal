import { useEffect, useState } from 'react'
import { api } from '../api'

type Me = {
  full_name: string
  role: string
}

type Live = { date?: string; currently_in?: unknown[] }

function roleLabel(role: string) {
  const m: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    ATTENDANCE_MANAGER: 'HR',
    LOCATION_MANAGER: 'Location',
    USER: 'Employee',
  }
  return m[role] || role
}

export function TopBar() {
  const [me, setMe] = useState<Me | null>(null)
  const [live, setLive] = useState<number | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    api<{ full_name: string; role: string }>('/auth/me')
      .then((u) => setMe(u))
      .catch(() => setMe(null))
  }, [])

  useEffect(() => {
    api<Live>('/attendance/live-status')
      .then((d) => setLive(Array.isArray(d.currently_in) ? d.currently_in.length : 0))
      .catch(() => setLive(null))
  }, [])

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-emerald-100 bg-white/90 px-6 py-3 backdrop-blur">
      <div className="relative min-w-[200px] flex-1 max-w-xl">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-emerald-600/50">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Staff खोजें (नाम / ID)..."
          className="w-full rounded-xl border border-emerald-100 bg-emerald-50/40 py-2.5 pl-10 pr-4 text-sm outline-none ring-emerald-600/20 focus:ring-2"
        />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-medium text-emerald-900">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live · {live === null ? '—' : `${live} in office`}
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-white px-3 py-2 shadow-sm">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-center text-sm font-bold leading-9 text-white">
            {(me?.full_name || '?')
              .split(/\s+/)
              .map((s) => s[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-emerald-950">{me?.full_name || '…'}</div>
            <div className="text-[11px] text-emerald-700/80">{me ? roleLabel(me.role) : ''}</div>
          </div>
        </div>
      </div>
    </header>
  )
}
