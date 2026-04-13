import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import {
  browserSupportsWebAuthn,
  createAttendanceWebAuthnPayload,
  fetchWebAuthnAttendanceStatus,
  type WebAuthnAttendanceStatus,
} from '../lib/webauthnAttendance'

/**
 * Large-touch friendly punch UI (same APIs as Attendance).
 */
export function KioskPage() {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const waRef = useRef<WebAuthnAttendanceStatus | null>(null)
  const [waHint, setWaHint] = useState<string | null>(null)

  const refreshWa = useCallback(async () => {
    try {
      const s = await fetchWebAuthnAttendanceStatus()
      waRef.current = s
      if (s.mode === 'required' && s.credCount === 0) {
        setWaHint('Passkey registration is required before punching. Use the Attendance page to register.')
      } else if (s.punchRequiresWebAuthn && !browserSupportsWebAuthn()) {
        setWaHint('This browser does not support passkeys; punches may fail.')
      } else {
        setWaHint(null)
      }
      return s
    } catch {
      const off: WebAuthnAttendanceStatus = { mode: 'off', credCount: 0, punchRequiresWebAuthn: false, rpId: '' }
      waRef.current = off
      setWaHint(null)
      return off
    }
  }, [])

  useEffect(() => {
    void refreshWa()
  }, [refreshWa])

  async function punch(kind: 'in' | 'out', office: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const path = kind === 'in' ? '/attendance/checkin' : '/attendance/checkout'
      const body: Record<string, unknown> = { source: 'kiosk' }
      if (office) {
        body.useBranchCenter = true
      } else {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000 })
        })
        body.lat = pos.coords.latitude
        body.lng = pos.coords.longitude
      }
      const s = waRef.current ?? (await refreshWa())
      if (s.punchRequiresWebAuthn) {
        if (!browserSupportsWebAuthn()) {
          throw new Error('This kiosk browser does not support passkeys (WebAuthn).')
        }
        body.webAuthn = await createAttendanceWebAuthnPayload()
      }
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      void refreshWa()
      setMsg(kind === 'in' ? 'Checked IN' : 'Checked OUT')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8 px-4 pb-12">
      <h1 className="text-3xl font-bold text-[#1f5e3b]">Kiosk</h1>
      {waHint && (
        <p className="max-w-xl text-center text-sm text-amber-900">
          {waHint}{' '}
          <Link to="/attendance" className="font-semibold text-[#1f5e3b] underline">
            Attendance
          </Link>
        </p>
      )}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => punch('in', false)}
          className="rounded-3xl bg-gradient-to-br from-[#1f5e3b] to-[#2e7d32] py-16 text-2xl font-bold text-white shadow-xl disabled:opacity-50"
        >
          Check in (GPS)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => punch('out', false)}
          className="rounded-3xl border-4 border-[#1f5e3b] bg-white py-16 text-2xl font-bold text-[#1f5e3b] shadow-xl disabled:opacity-50"
        >
          Check out (GPS)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => punch('in', true)}
          className="rounded-3xl bg-[#66bb6a]/25 py-10 text-xl font-bold text-[#1f5e3b] disabled:opacity-50 sm:col-span-2"
        >
          Check in — office location
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => punch('out', true)}
          className="rounded-3xl bg-[#66bb6a]/25 py-10 text-xl font-bold text-[#1f5e3b] disabled:opacity-50 sm:col-span-2"
        >
          Check out — office location
        </button>
      </div>
      {msg && <p className="text-lg font-semibold text-[#14261a]">{msg}</p>}
    </div>
  )
}
