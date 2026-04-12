import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type Branch = {
  id: number
  name: string
  lat: number | null
  lng: number | null
  radius_meters: number
}

export function OfficePage() {
  const { user } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [err, setErr] = useState<string | null>(null)

  const can = canPerm(user, 'branches:read')

  useEffect(() => {
    if (!can) return
    api<{ branches: Branch[] }>('/branches')
      .then((d) => setBranches(d.branches || []))
      .catch((e) => setErr((e as Error).message))
  }, [can])

  if (!can) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center text-sm text-[#1f5e3b]">
        Office / branch directory is available to managers. Your assigned branch is managed by HR.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Office locations</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {branches.map((b) => (
          <div key={b.id} className="ph-card rounded-2xl p-5">
            <h2 className="font-semibold text-[#1f5e3b]">{b.name}</h2>
            <p className="mt-2 text-sm text-[#14261a]/85">
              Geo: {b.lat != null && b.lng != null ? `${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}` : 'Not set'}
            </p>
            <p className="text-sm text-[#14261a]/85">Radius: {b.radius_meters} m</p>
          </div>
        ))}
      </div>
    </div>
  )
}
