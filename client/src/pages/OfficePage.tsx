import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type Branch = {
  id: number
  name: string
  lat: number | null
  lng: number | null
  radius_meters: number
  address?: string | null
  city?: string | null
  state?: string | null
  wifi_enabled?: number
  wifi_ssids?: string | null
}

export function OfficePage() {
  const { user } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('300')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [wifiEnabled, setWifiEnabled] = useState(false)
  const [wifiSsids, setWifiSsids] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const can = canPerm(user, 'branches:read')
  const canWrite = canPerm(user, 'branches:write')
  const parseSsids = (raw?: string | null) => {
    if (!raw) return []
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.map((x) => String(x)) : []
    } catch {
      return []
    }
  }

  const refresh = useCallback(() => {
    if (!can) return
    api<{ branches: Branch[] }>('/branches')
      .then((d) => setBranches(d.branches || []))
      .catch((e) => setErr((e as Error).message))
  }, [can])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function submitBranch(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      const payload = {
        name: name.trim(),
        lat: lat.trim() ? Number(lat) : null,
        lng: lng.trim() ? Number(lng) : null,
        radius_meters: Number(radius) || 300,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        wifi_enabled: wifiEnabled,
        wifi_ssids: wifiSsids
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      }
      if (!payload.name) throw new Error('Branch name required')
      if (editingId) await api(`/branches/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      else await api('/branches', { method: 'POST', body: JSON.stringify(payload) })
      setName('')
      setLat('')
      setLng('')
      setRadius('300')
      setAddress('')
      setCity('')
      setState('')
      setWifiEnabled(false)
      setWifiSsids('')
      setEditingId(null)
      refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function deleteBranch(id: number) {
    setErr(null)
    try {
      await api(`/branches/${id}`, { method: 'DELETE' })
      refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

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
      {canWrite && (
        <form onSubmit={submitBranch} className="ph-card grid gap-3 rounded-2xl p-5 sm:grid-cols-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Location name" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="Radius (m)" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm sm:col-span-2" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
          <input value={wifiSsids} onChange={(e) => setWifiSsids(e.target.value)} placeholder="Allowed SSIDs (comma separated)" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm sm:col-span-2" />
          <label className="flex items-center gap-2 rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm">
            <input type="checkbox" checked={wifiEnabled} onChange={(e) => setWifiEnabled(e.target.checked)} />
            Enable branch WiFi restriction
          </label>
          <button type="submit" className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white">{editingId ? 'Update location' : 'Add location'}</button>
          {editingId && (
            <button type="button" onClick={() => setEditingId(null)} className="rounded-xl border border-[#1f5e3b]/20 px-4 py-2 text-sm">
              Cancel edit
            </button>
          )}
        </form>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {branches.map((b) => (
          <div key={b.id} className="ph-card rounded-2xl p-5">
            <h2 className="font-semibold text-[#1f5e3b]">{b.name}</h2>
            <p className="mt-2 text-sm text-[#14261a]/85">
              Geo: {b.lat != null && b.lng != null ? `${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}` : 'Not set'}
            </p>
            <p className="text-sm text-[#14261a]/85">Radius: {b.radius_meters} m</p>
            <p className="text-sm text-[#14261a]/85">Address: {b.address || '—'}</p>
            <p className="text-sm text-[#14261a]/85">City: {b.city || '—'}</p>
            <p className="text-sm text-[#14261a]/85">State: {b.state || '—'}</p>
            <p className="text-sm text-[#14261a]/85">
              WiFi policy: {Number(b.wifi_enabled || 0) ? 'Enabled' : 'Disabled'}{' '}
              {parseSsids(b.wifi_ssids).length > 0 ? `(${parseSsids(b.wifi_ssids).join(', ')})` : ''}
            </p>
            {canWrite && (
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  className="text-sm font-semibold text-[#2e7d32] underline"
                  onClick={() => {
                    setEditingId(b.id)
                    setName(b.name)
                    setLat(b.lat == null ? '' : String(b.lat))
                    setLng(b.lng == null ? '' : String(b.lng))
                    setRadius(String(b.radius_meters || 300))
                    setAddress(String(b.address || ''))
                    setCity(String(b.city || ''))
                    setState(String(b.state || ''))
                    setWifiEnabled(Number(b.wifi_enabled || 0) === 1)
                    setWifiSsids(parseSsids(b.wifi_ssids).join(', '))
                  }}
                >
                  Edit
                </button>
                <button type="button" className="text-sm font-semibold text-red-700 underline" onClick={() => void deleteBranch(b.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
