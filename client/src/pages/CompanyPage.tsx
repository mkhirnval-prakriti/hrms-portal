import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

export function CompanyPage() {
  const { user } = useAuth()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const can = canPerm(user, 'settings:read')

  useEffect(() => {
    if (!can) return
    api('/settings')
      .then((d) => setData(d as Record<string, unknown>))
      .catch((e) => setErr((e as Error).message))
  }, [can])

  if (!can) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center text-sm text-[#1f5e3b]">
        Company settings are visible to HR / Admin roles.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Company</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {data && (
        <div className="ph-card rounded-2xl p-6 text-sm">
          <pre className="overflow-x-auto whitespace-pre-wrap text-[#14261a]">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
