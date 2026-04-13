import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type PendingRow = {
  id: number
  user_id: number
  requester_id: number
  kind: string
  notes: string | null
  created_at: string
  user_name: string
  user_email: string
  branch_id: number | null
  requester_name: string
}

export function BiometricAdminPage() {
  const { user } = useAuth()
  const allowed = canPerm(user, 'biometric:admin')
  const [pending, setPending] = useState<PendingRow[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejectId, setRejectId] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const [targetUserId, setTargetUserId] = useState('')
  const [adminFaceFile, setAdminFaceFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    if (!allowed) return
    setMsg(null)
    try {
      const d = await api<{ requests: PendingRow[] }>('/biometric/requests/pending')
      setPending(d.requests || [])
    } catch (e) {
      setMsg((e as Error).message || 'Failed to load')
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  async function approve(id: number) {
    setBusy(true)
    setMsg(null)
    try {
      await api(`/biometric/requests/${id}/approve`, { method: 'POST', body: '{}' })
      setMsg('Approved.')
      await load()
    } catch (e) {
      setMsg((e as Error).message || 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  async function reject(id: number) {
    setBusy(true)
    setMsg(null)
    try {
      await api(`/biometric/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      })
      setMsg('Rejected.')
      setRejectId(null)
      setRejectReason('')
      await load()
    } catch (e) {
      setMsg((e as Error).message || 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  async function adminEnrollFace() {
    const id = Number(targetUserId)
    if (!Number.isFinite(id) || id <= 0) {
      setMsg('Enter a valid user ID.')
      return
    }
    if (!adminFaceFile || adminFaceFile.size < 8192) {
      setMsg('Choose a clear photo (min ~8KB).')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('photo', adminFaceFile, 'face.jpg')
      await api(`/users/${id}/face-enrollment`, { method: 'POST', body: fd })
      setMsg(`Face enrolled for user ${id}.`)
      setAdminFaceFile(null)
    } catch (e) {
      setMsg((e as Error).message || 'Enrollment failed')
    } finally {
      setBusy(false)
    }
  }

  async function resetFace() {
    const id = Number(targetUserId)
    if (!Number.isFinite(id) || id <= 0) {
      setMsg('Enter a valid user ID.')
      return
    }
    if (!window.confirm(`Clear face profile for user ${id}?`)) return
    setBusy(true)
    setMsg(null)
    try {
      await api(`/biometric/admin/users/${id}/reset-face`, { method: 'POST', body: '{}' })
      setMsg('Face profile cleared.')
    } catch (e) {
      setMsg((e as Error).message || 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  async function resetWebauthn() {
    const id = Number(targetUserId)
    if (!Number.isFinite(id) || id <= 0) {
      setMsg('Enter a valid user ID.')
      return
    }
    if (!window.confirm(`Remove ALL passkeys for user ${id}? They must register again on their device.`)) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api<{ ok: boolean; removed: number }>(`/biometric/admin/users/${id}/reset-webauthn`, {
        method: 'POST',
        body: '{}',
      })
      setMsg(`Removed ${r.removed} passkey(s).`)
    } catch (e) {
      setMsg((e as Error).message || 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-red-700">You do not have access to biometric administration.</p>
        <Link to="/" className="mt-4 inline-block font-semibold text-[#2e7d32] underline">
          Home
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Biometric requests</h1>
        <p className="mt-1 text-sm text-[#1f5e3b]/75">
          Approve or reject staff requests. Branch managers only see users in their branch.
        </p>
      </div>

      {msg && <p className="rounded-xl bg-white p-3 text-sm shadow ring-1 ring-[#1f5e3b]/10">{msg}</p>}

      <div className="ph-card rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Pending</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-[#1f5e3b]/60">No pending requests.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="rounded-xl border border-[#1f5e3b]/12 bg-white/80 p-4">
                <p className="text-sm font-semibold text-[#14261a]">
                  {r.user_name} <span className="font-normal text-[#1f5e3b]/70">(user #{r.user_id})</span>
                </p>
                <p className="text-xs text-[#1f5e3b]/70">
                  {r.user_email} · Kind: <span className="font-semibold capitalize">{r.kind}</span> · Requested{' '}
                  {new Date(r.created_at).toLocaleString()} · By {r.requester_name}
                </p>
                {r.notes ? <p className="mt-1 text-xs text-[#14261a]">Note: {r.notes}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => approve(r.id)}
                    className="rounded-lg bg-[#1f5e3b] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  {rejectId === r.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="rounded border border-[#1f5e3b]/20 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => reject(r.id)}
                        className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Confirm reject
                      </button>
                      <button type="button" className="text-xs underline" onClick={() => setRejectId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRejectId(r.id)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-800"
                    >
                      Reject
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => load()} className="mt-4 text-sm font-semibold text-[#2e7d32] underline">
          Refresh
        </button>
      </div>

      <div className="ph-card rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Direct admin actions</h2>
        <p className="mt-1 text-xs text-[#1f5e3b]/70">
          Enroll or reset identity data for an employee without going through the request flow. All actions are audit
          logged.
        </p>
        <label className="mt-4 block text-sm">
          <span className="font-medium text-[#1f5e3b]">User ID</span>
          <input
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            className="mt-1 w-full max-w-xs rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            placeholder="e.g. 42"
          />
        </label>
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-[#1f5e3b]">Enroll / replace face (photo file)</p>
            <input
              type="file"
              accept="image/*"
              className="mt-1 text-sm"
              onChange={(e) => setAdminFaceFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => adminEnrollFace()}
              className="mt-2 rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save face for user
            </button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#1f5e3b]/10 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => resetFace()}
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950"
            >
              Clear face profile
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => resetWebauthn()}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900"
            >
              Remove all passkeys
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-sm">
        <Link to="/identity" className="font-semibold text-[#2e7d32] underline">
          Staff Identity page
        </Link>
      </p>
    </div>
  )
}
