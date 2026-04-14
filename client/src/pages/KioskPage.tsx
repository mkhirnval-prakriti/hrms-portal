import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import * as faceapi from 'face-api.js'
import { captureVideoFrameToJpegBlob, getFaceCameraConstraints } from '../lib/faceCapture'
import { descriptorToJson, ensureFaceModelsLoaded } from '../lib/faceApiLiveness'
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
  const [loginId, setLoginId] = useState('')
  const [pin, setPin] = useState('')
  const [manualUserId, setManualUserId] = useState('')
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10))
  const [camOn, setCamOn] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [autoFaceEnabled, setAutoFaceEnabled] = useState(true)
  const [lastMatchName, setLastMatchName] = useState('')
  const [registerLoginId, setRegisterLoginId] = useState('')
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedDescriptorJson, setCapturedDescriptorJson] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

  async function startFaceCamera() {
    setMsg(null)
    try {
      await ensureFaceModelsLoaded()
      const stream = await navigator.mediaDevices.getUserMedia(getFaceCameraConstraints())
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamOn(true)
    } catch (e) {
      setMsg((e as Error).message || 'Could not start camera.')
    }
  }

  function stopFaceCamera() {
    const v = videoRef.current
    if (v?.srcObject) {
      ;(v.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
      v.srcObject = null
    }
    setCamOn(false)
    setFaceDetected(false)
  }

  async function registerFaceFromCapture() {
    if (!registerLoginId.trim() || !capturedBlob || !capturedDescriptorJson) {
      setMsg('Enter employee ID and capture face first.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('photo', capturedBlob, 'face.jpg')
      fd.append('faceDescriptor', capturedDescriptorJson)
      fd.append('login_id', registerLoginId.trim())
      await api('/kiosk/face/register', { method: 'POST', body: fd })
      setMsg('Face registered/updated successfully. Auto attendance is now enabled for this user.')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!camOn || !autoFaceEnabled) return
    let active = true
    const timer = window.setInterval(async () => {
      if (!active || busy) return
      if (Date.now() < cooldownUntil) return
      const v = videoRef.current
      const c = canvasRef.current
      if (!v || !c || !v.videoWidth) return
      try {
        const det = await faceapi
          .detectSingleFace(v, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
          .withFaceLandmarks()
          .withFaceDescriptor()
        setFaceDetected(!!det)
        if (!det) return
        const blob = await captureVideoFrameToJpegBlob(v, c)
        if (!blob) return
        const descriptorJson = descriptorToJson(det.descriptor)
        setCapturedBlob(blob)
        setCapturedDescriptorJson(descriptorJson)
        const fdMatch = new FormData()
        fdMatch.append('photo', blob, 'face.jpg')
        fdMatch.append('faceDescriptor', descriptorJson)
        const m = await api<{ matched_user_id: number; full_name: string; login_id: string }>('/kiosk/face/match', {
          method: 'POST',
          body: fdMatch,
        })
        const fdPunch = new FormData()
        fdPunch.append('photo', blob, 'face.jpg')
        fdPunch.append('faceDescriptor', descriptorJson)
        fdPunch.append('matched_user_id', String(m.matched_user_id))
        await api('/attendance/face-punch', {
          method: 'POST',
          body: fdPunch,
        })
        setLastMatchName(m.full_name)
        setMsg(`${m.full_name} matched. Attendance marked automatically.`)
        setCooldownUntil(Date.now() + 8000)
      } catch (e) {
        const text = (e as Error).message || 'Face scan failed.'
        if (text.toLowerCase().includes('not registered')) {
          setMsg('User not registered')
          setCooldownUntil(Date.now() + 2500)
        } else if (text.toLowerCase().includes('already punched out')) {
          setMsg('Today attendance already completed for matched user.')
          setCooldownUntil(Date.now() + 5000)
        } else if (!text.toLowerCase().includes('network')) {
          setMsg(text)
        }
      }
    }, 1800)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [autoFaceEnabled, camOn, busy, cooldownUntil])

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

  async function pinPunch(type: 'in' | 'out') {
    setBusy(true)
    setMsg(null)
    try {
      await api('/kiosk/pin/punch', {
        method: 'POST',
        body: JSON.stringify({ login_id: loginId, pin, type }),
      })
      setMsg(type === 'in' ? 'PIN check-in marked.' : 'PIN check-out marked.')
      setPin('')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function manualOverride(status: 'present' | 'absent' | 'leave') {
    setBusy(true)
    setMsg(null)
    try {
      await api('/attendance/manual', {
        method: 'POST',
        body: JSON.stringify({
          userId: Number(manualUserId),
          workDate: manualDate,
          status,
          notes: 'Kiosk manager override',
        }),
      })
      setMsg(`Manual override saved as ${status}.`)
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
      <div className="w-full max-w-2xl rounded-2xl border border-[#1f5e3b]/15 bg-white p-4">
        <h2 className="text-base font-semibold text-[#1f5e3b]">Auto face attendance</h2>
        <p className="mt-1 text-xs text-[#1f5e3b]/70">Face detect → match → attendance punch (no manual input).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!camOn ? (
            <button type="button" onClick={() => void startFaceCamera()} className="rounded-lg bg-[#1f5e3b] px-3 py-2 text-xs font-semibold text-white">
              Open face camera
            </button>
          ) : (
            <button type="button" onClick={stopFaceCamera} className="rounded-lg border border-[#1f5e3b]/25 px-3 py-2 text-xs font-semibold text-[#1f5e3b]">
              Close face camera
            </button>
          )}
          <label className="flex items-center gap-2 rounded-lg border border-[#1f5e3b]/20 px-3 py-2 text-xs">
            <input type="checkbox" checked={autoFaceEnabled} onChange={(e) => setAutoFaceEnabled(e.target.checked)} />
            Auto scan enabled
          </label>
          <span className={`rounded-lg px-3 py-2 text-xs font-semibold ${faceDetected ? 'bg-[#e8f5e9] text-[#1f5e3b]' : 'bg-[#fff3e0] text-[#8a4b08]'}`}>
            {faceDetected ? 'Face detected' : 'No face detected'}
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <video ref={videoRef} playsInline muted className="min-h-32 rounded-xl border border-[#1f5e3b]/20 bg-black/5" />
          <div className="space-y-2 rounded-xl border border-[#1f5e3b]/10 bg-[#f7fbf8] p-3">
            <p className="text-xs font-semibold text-[#1f5e3b]">First-time / update face</p>
            <input
              value={registerLoginId}
              onChange={(e) => setRegisterLoginId(e.target.value)}
              placeholder="Employee ID (login_id)"
              className="w-full rounded-lg border border-[#1f5e3b]/20 px-3 py-2 text-xs"
            />
            <button type="button" disabled={busy} onClick={() => void registerFaceFromCapture()} className="rounded-lg border border-[#1f5e3b]/25 px-3 py-2 text-xs font-semibold text-[#1f5e3b]">
              Register / update from current face
            </button>
            {lastMatchName && <p className="text-xs text-[#1f5e3b]/75">Last matched: {lastMatchName}</p>}
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
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
      <div className="w-full max-w-2xl rounded-2xl border border-[#1f5e3b]/15 bg-white p-4">
        <h2 className="text-base font-semibold text-[#1f5e3b]">PIN attendance</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="Employee ID (login_id)"
            className="rounded-xl border border-[#1f5e3b]/20 px-3 py-2 text-sm"
          />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            type="password"
            className="rounded-xl border border-[#1f5e3b]/20 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => pinPunch('in')} className="rounded-lg bg-[#1f5e3b] px-3 py-2 text-xs font-semibold text-white">
            PIN check-in
          </button>
          <button type="button" disabled={busy} onClick={() => pinPunch('out')} className="rounded-lg border border-[#1f5e3b]/25 px-3 py-2 text-xs font-semibold text-[#1f5e3b]">
            PIN check-out
          </button>
        </div>
      </div>
      <div className="w-full max-w-2xl rounded-2xl border border-[#1f5e3b]/15 bg-white p-4">
        <h2 className="text-base font-semibold text-[#1f5e3b]">Face register/update</h2>
        <p className="mt-1 text-xs text-[#1f5e3b]/70">Use the biometric enrollment flow inside HRMS kiosk session.</p>
        <Link to="/identity" className="mt-2 inline-block text-sm font-semibold text-[#1f5e3b] underline">
          Open face register/update
        </Link>
      </div>
      <div className="w-full max-w-2xl rounded-2xl border border-[#1f5e3b]/15 bg-white p-4">
        <h2 className="text-base font-semibold text-[#1f5e3b]">Manual attendance override</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={manualUserId}
            onChange={(e) => setManualUserId(e.target.value)}
            placeholder="User ID"
            className="rounded-xl border border-[#1f5e3b]/20 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={manualDate}
            onChange={(e) => setManualDate(e.target.value)}
            className="rounded-xl border border-[#1f5e3b]/20 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => manualOverride('present')} className="rounded-lg bg-[#2e7d32] px-3 py-2 text-xs font-semibold text-white">
            Mark present
          </button>
          <button type="button" disabled={busy} onClick={() => manualOverride('leave')} className="rounded-lg border border-[#1f5e3b]/25 px-3 py-2 text-xs font-semibold text-[#1f5e3b]">
            Mark leave
          </button>
          <button type="button" disabled={busy} onClick={() => manualOverride('absent')} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">
            Mark absent
          </button>
        </div>
      </div>
      {msg && <p className="text-lg font-semibold text-[#14261a]">{msg}</p>}
    </div>
  )
}
