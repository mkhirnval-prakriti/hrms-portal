import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiFetchUrl, getToken } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { localDateStr } from '../lib/date'
import { Link } from 'react-router-dom'
import { captureVideoFrameToJpegBlob, getFaceCameraConstraints } from '../lib/faceCapture'
import { descriptorToJson, runLivenessAndFaceDescriptor } from '../lib/faceApiLiveness'
import {
  browserSupportsWebAuthn,
  createAttendanceWebAuthnPayload,
  fetchWebAuthnAttendanceStatus,
  type WebAuthnAttendanceStatus,
} from '../lib/webauthnAttendance'

type AttRow = {
  id: number
  user_id: number
  work_date: string
  punch_in_at: string | null
  punch_out_at: string | null
  status: string
  full_name?: string
  punch_in_photo?: string | null
  punch_method_in?: string | null
  punch_method_out?: string | null
  verification_in?: string | null
}
type WarnRow = { type: string; severity: string; message: string }
type Branch = { id: number; name: string }

export function AttendancePage() {
  const { user } = useAuth()
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 14)
    return localDateStr(d)
  })
  const [to, setTo] = useState(() => localDateStr())
  const [records, setRecords] = useState<AttRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [punchMsg, setPunchMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterBranchId, setFilterBranchId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [wifiSsid, setWifiSsid] = useState('')
  const [warnings, setWarnings] = useState<WarnRow[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [camOn, setCamOn] = useState(false)
  const [faceBlob, setFaceBlob] = useState<Blob | null>(null)
  const [faceDescriptorJson, setFaceDescriptorJson] = useState<string | null>(null)
  const [bioHint, setBioHint] = useState<{
    hasFace: boolean
    webauthnCount: number
    faceEmbeddingActive?: boolean
  } | null>(null)

  const today = localDateStr()
  const canAll = canPerm(user, 'history:read')
  const [geoWarned, setGeoWarned] = useState(false)

  const waStatusRef = useRef<WebAuthnAttendanceStatus | null>(null)
  const [waStatus, setWaStatus] = useState<WebAuthnAttendanceStatus | null>(null)
  const refreshWaStatus = useCallback(async () => {
    try {
      const s = await fetchWebAuthnAttendanceStatus()
      waStatusRef.current = s
      setWaStatus(s)
      return s
    } catch {
      const fallback: WebAuthnAttendanceStatus = {
        mode: 'off',
        credCount: 0,
        punchRequiresWebAuthn: false,
        rpId: '',
      }
      waStatusRef.current = fallback
      setWaStatus(fallback)
      return fallback
    }
  }, [])

  const refreshIdentityHint = useCallback(async () => {
    try {
      const b = await api<{ hasFace: boolean; webauthnCount: number; faceEmbeddingActive?: boolean }>(
        '/biometric/status'
      )
      setBioHint({
        hasFace: !!b.hasFace,
        webauthnCount: Number(b.webauthnCount || 0),
        faceEmbeddingActive: !!b.faceEmbeddingActive,
      })
    } catch {
      setBioHint(null)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void (async () => {
      await refreshWaStatus()
      await refreshIdentityHint()
    })()
  }, [user, refreshWaStatus, refreshIdentityHint])

  async function attachWebAuthnIfNeeded(bodyOrAppend: Record<string, unknown> | FormData) {
    const s = waStatusRef.current ?? (await refreshWaStatus())
    if (!s.punchRequiresWebAuthn) return
    if (!browserSupportsWebAuthn()) {
      throw new Error('This browser does not support passkeys (WebAuthn).')
    }
    const payload = await createAttendanceWebAuthnPayload()
    if (bodyOrAppend instanceof FormData) {
      bodyOrAppend.append('webAuthn', JSON.stringify(payload))
    } else {
      bodyOrAppend.webAuthn = payload
    }
  }

  function speak(text: string) {
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'hi-IN'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('from', from)
      params.set('to', to)
      if (filterStatus) params.set('status', filterStatus)
      if (filterBranchId) params.set('branchId', filterBranchId)
      const q = `?${params.toString()}`
      let rows: AttRow[] = []
      try {
        const data = await api<{ records: AttRow[] }>('/attendance/history' + q)
        rows = data.records || []
        console.log('[attendance] /attendance/history', { query: q, count: rows.length })
      } catch (historyErr) {
        console.warn('[attendance] history failed, trying /attendance', historyErr)
        const data2 = await api<{ attendance: AttRow[] }>('/attendance' + q)
        rows = (data2.attendance || []).map((r) => ({
          ...r,
          work_date: (r as unknown as { workDate?: string }).workDate || r.work_date,
          user_id: (r as unknown as { userId?: number }).userId || r.user_id,
          full_name: (r as unknown as { userName?: string }).userName || r.full_name,
          punch_in_at: (r as unknown as { checkIn?: string | null }).checkIn || r.punch_in_at,
          punch_out_at: (r as unknown as { checkOut?: string | null }).checkOut || r.punch_out_at,
        }))
        console.log('[attendance] /attendance fallback', { query: q, count: rows.length })
      }
      setRecords(rows)
      const w = await api<{ warnings: WarnRow[] }>('/warnings/me')
      setWarnings(w.warnings || [])
      if (canAll) {
        const b = await api<{ branches: Branch[] }>('/branches')
        setBranches(b.branches || [])
      }
      await refreshIdentityHint()
    } catch (e) {
      setErr((e as Error).message)
      setRecords([])
      setWarnings([])
    } finally {
      setLoading(false)
    }
  }, [from, to, filterStatus, filterBranchId, refreshIdentityHint, canAll])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const todayRows = records.filter((r) => r.work_date === today)
  const myToday = todayRows.find((r) => r.user_id === user?.id)

  let filtered = records
  if (filterStatus) {
    filtered = filtered.filter((r) => String(r.status || '').toLowerCase() === filterStatus.toLowerCase())
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    filtered = filtered.filter((r) => `${r.full_name || ''} ${r.user_id}`.toLowerCase().includes(q))
  }

  async function punchJson(
    kind: 'in' | 'out',
    useOffice: boolean,
    method: 'gps' | 'office' | 'fingerprint',
    extra?: Record<string, unknown>
  ) {
    setPunchMsg(null)
    setBusy(true)
    try {
      const path = kind === 'in' ? '/attendance/checkin' : '/attendance/checkout'
      const body: Record<string, unknown> = {
        type: kind,
        source: 'device',
        attendanceMethod: method === 'office' ? 'office' : method,
        wifi_ssid: wifiSsid.trim() || undefined,
        ...extra,
      }
      if (useOffice) {
        body.useBranchCenter = true
      } else if (method === 'gps') {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000 })
        })
        body.lat = pos.coords.latitude
        body.lng = pos.coords.longitude
      } else if (method === 'fingerprint') {
        body.useBranchCenter = true
        body.verificationStatus = 'pending'
      }
      await attachWebAuthnIfNeeded(body)
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      void refreshWaStatus()
      setPunchMsg(kind === 'in' ? 'Checked in successfully.' : 'Checked out successfully.')
      if (kind === 'in') speak('Welcome to Prakriti Herbs, aapki attendance lag gayi hai')
      if (kind === 'out') speak('Prakriti Herbs mein aaj ki attendance dene ke liye dhanyavaad')
      await load()
    } catch (e) {
      setPunchMsg((e as Error).message || 'Punch failed')
    } finally {
      setBusy(false)
    }
  }

  async function startCamera() {
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia(getFaceCameraConstraints())
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamOn(true)
    } catch {
      setErr('Camera access denied or unavailable.')
    }
  }

  /** Opens camera, grabs one scaled frame, closes — fewer taps for attendance. */
  async function quickFaceCapture() {
    if (bioHint?.faceEmbeddingActive) {
      setPunchMsg('AI face profile is on — use Open camera, then Live verify & capture (blink + small head move).')
      return
    }
    setErr(null)
    setPunchMsg(null)
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia(getFaceCameraConstraints())
      v.srcObject = stream
      await v.play()
      await new Promise<void>((res) => {
        if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) res()
        else v.onloadeddata = () => res()
      })
      await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))
      const blob = await captureVideoFrameToJpegBlob(v, c)
      stream.getTracks().forEach((t) => t.stop())
      v.srcObject = null
      setCamOn(false)
      if (blob && blob.size >= 8192) {
        setFaceDescriptorJson(null)
        setFaceBlob(blob)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(URL.createObjectURL(blob))
        setPunchMsg('Photo captured — tap Check in (face) or Check out (face).')
      } else {
        setPunchMsg('Photo too small — try brighter light or use Open camera, then Capture.')
      }
    } catch {
      setErr('Camera access denied or unavailable.')
    }
  }

  function stopCamera() {
    const v = videoRef.current
    if (v && v.srcObject) {
      ;(v.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
      v.srcObject = null
    }
    setCamOn(false)
    setFaceDescriptorJson(null)
  }

  async function liveVerifyAndCapture() {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || !v.videoWidth) {
      setPunchMsg('Open the camera first.')
      return
    }
    setPunchMsg(null)
    setBusy(true)
    try {
      const desc = await runLivenessAndFaceDescriptor(v)
      setFaceDescriptorJson(descriptorToJson(desc))
      const blob = await captureVideoFrameToJpegBlob(v, c)
      if (blob && blob.size >= 8192) {
        setFaceBlob(blob)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(URL.createObjectURL(blob))
        setPunchMsg('Live check passed — tap Check in (face) or Check out (face).')
      } else {
        setFaceDescriptorJson(null)
        setPunchMsg('Photo too small after live check — adjust light and retry.')
      }
    } catch (e) {
      setFaceDescriptorJson(null)
      setPunchMsg((e as Error).message || 'Live check failed')
    } finally {
      setBusy(false)
    }
  }

  async function capturePreview() {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || !v.videoWidth) return
    const blob = await captureVideoFrameToJpegBlob(v, c)
    if (blob) {
      if (bioHint?.faceEmbeddingActive) {
        setFaceDescriptorJson(null)
      }
      setFaceBlob(blob)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
    }
  }

  async function punchFace(kind: 'in' | 'out') {
    if (!faceBlob || faceBlob.size < 8192) {
      setPunchMsg('Capture a clearer photo (min ~8KB) using Face scan.')
      return
    }
    if (bioHint?.faceEmbeddingActive && !faceDescriptorJson) {
      setPunchMsg('Live face check required — use Live verify & capture before punching.')
      return
    }
    setPunchMsg(null)
    setBusy(true)
    try {
      const path = kind === 'in' ? '/attendance/checkin' : '/attendance/checkout'
      const fd = new FormData()
      fd.append('type', kind)
      fd.append('source', 'device')
      fd.append('attendanceMethod', 'face')
      if (wifiSsid.trim()) fd.append('wifi_ssid', wifiSsid.trim())
      if (user?.branch_id) fd.append('useBranchCenter', 'true')
      fd.append('photo', faceBlob, 'face.jpg')
      if (faceDescriptorJson) fd.append('faceDescriptor', faceDescriptorJson)
      await attachWebAuthnIfNeeded(fd)
      const token = getToken()
      const res = await fetch(apiFetchUrl(path), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
        credentials: 'include',
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok) throw new Error(data?.error || res.statusText)
      void refreshWaStatus()
      setPunchMsg(kind === 'in' ? 'Checked in with face.' : 'Checked out with face.')
      if (kind === 'in') speak('Welcome to Prakriti Herbs, aapki attendance lag gayi hai')
      if (kind === 'out') speak('Prakriti Herbs mein aaj ki attendance dene ke liye dhanyavaad')
      setFaceBlob(null)
      setFaceDescriptorJson(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      stopCamera()
      await load()
    } catch (e) {
      setPunchMsg((e as Error).message || 'Face punch failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!user?.shift_end) return
    const [hh, mm] = String(user.shift_end).split(':').map((x) => Number(x) || 0)
    const t = window.setInterval(() => {
      const now = new Date()
      if (now.getHours() === hh && Math.abs(now.getMinutes() - mm) <= 2) {
        speak('Sir, aapka punch-out ka time ho gaya hai')
      }
    }, 60000)
    return () => window.clearInterval(t)
  }, [user?.shift_end])

  useEffect(() => {
    if (!user?.branch_id || geoWarned || !navigator.geolocation) return
    let stop = false
    let watchId: number | null = null
    api<{ branches: { id: number; lat: number | null; lng: number | null; radius_meters: number }[] }>('/branches')
      .then((d) => {
        if (stop) return
        const b = (d.branches || []).find((x) => Number(x.id) === Number(user.branch_id))
        if (!b || b.lat == null || b.lng == null) return
        watchId = navigator.geolocation.watchPosition((pos) => {
          const r = Number(b.radius_meters || 300)
          const toRad = (n: number) => (n * Math.PI) / 180
          const R = 6371000
          const dLat = toRad(pos.coords.latitude - Number(b.lat))
          const dLng = toRad(pos.coords.longitude - Number(b.lng))
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(Number(b.lat))) *
              Math.cos(toRad(pos.coords.latitude)) *
              Math.sin(dLng / 2) ** 2
          const dist = 2 * R * Math.asin(Math.sqrt(a))
          if (dist > r) {
            speak('Aap allowed zone se bahar ja rahe hain')
            setGeoWarned(true)
          }
        })
      })
      .catch(() => {})
    return () => {
      stop = true
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [geoWarned, user?.branch_id])

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Attendance Dashboard</h1>
        <p className="text-sm text-[#1f5e3b]/70">
          Choose GPS, office location, face capture, or fingerprint (device-ready). When your organization enables
          passkeys, you verify with your device PIN or biometrics before each punch. Photo history appears in the table
          below.
        </p>
      </div>
      {warnings.length > 0 && (
        <div className="ph-card rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900">Auto warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {warnings.map((w, idx) => (
              <li key={idx}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="ph-card rounded-2xl border border-[#1f5e3b]/10 p-4">
        <p className="text-sm text-[#14261a]">
          <span className="font-semibold text-[#1f5e3b]">Identity & biometrics</span> — first-time face and passkey setup,
          and any updates after manager approval, live on the Identity page (keeps attendance here fast).{' '}
          <Link to="/identity" className="font-semibold text-[#2e7d32] underline">
            Open Identity
          </Link>
        </p>
        {waStatus?.punchRequiresWebAuthn && (
          <p className="mt-2 text-xs text-[#1f5e3b]/80">
            Punches use WebAuthn when your org enables it. RP ID: <span className="font-mono">{waStatus.rpId || '—'}</span>
          </p>
        )}
        {waStatus?.mode === 'required' && waStatus.credCount === 0 && (
          <p className="mt-2 text-sm font-medium text-red-700">
            A passkey is required before punching — register it under Identity.
          </p>
        )}
        {!browserSupportsWebAuthn() && waStatus?.punchRequiresWebAuthn && (
          <p className="mt-1 text-xs font-medium text-amber-900">This browser does not support passkeys.</p>
        )}
      </div>

      <div className="ph-card rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Today · {today}</h2>
        {myToday && (
          <p className="mt-2 text-sm text-[#14261a]">
            Status: <span className="font-semibold capitalize">{myToday.status}</span>
            {myToday.punch_in_at && (
              <span className="ml-2 text-[#1f5e3b]/80">In: {new Date(myToday.punch_in_at).toLocaleString()}</span>
            )}
            {myToday.punch_out_at && (
              <span className="ml-2 text-[#1f5e3b]/80">Out: {new Date(myToday.punch_out_at).toLocaleString()}</span>
            )}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="w-full text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">WiFi SSID (optional, if office WiFi restriction enabled)</span>
            <input value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)} className="w-full max-w-md rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" placeholder="e.g. Prakriti-Office" />
          </label>
          <span className="w-full text-xs font-semibold uppercase tracking-wide text-[#1f5e3b]/70">GPS</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => punchJson('in', false, 'gps')}
            className="rounded-xl bg-gradient-to-r from-[#1f5e3b] to-[#2e7d32] px-4 py-2 text-sm font-semibold text-white shadow-md disabled:opacity-50"
          >
            Check in (GPS)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => punchJson('out', false, 'gps')}
            className="rounded-xl border border-[#1f5e3b]/25 bg-white px-4 py-2 text-sm font-semibold text-[#1f5e3b] shadow-sm disabled:opacity-50"
          >
            Check out (GPS)
          </button>
          <span className="w-full pt-2 text-xs font-semibold uppercase tracking-wide text-[#1f5e3b]/70">
            Office location
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => punchJson('in', true, 'office')}
            className="rounded-xl bg-[#66bb6a]/20 px-4 py-2 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
          >
            Check in (office)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => punchJson('out', true, 'office')}
            className="rounded-xl bg-[#66bb6a]/20 px-4 py-2 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
          >
            Check out (office)
          </button>
          <span className="w-full pt-2 text-xs font-semibold uppercase tracking-wide text-[#1f5e3b]/70">
            Fingerprint (API-ready)
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => punchJson('in', true, 'fingerprint')}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            Check in (fingerprint)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => punchJson('out', true, 'fingerprint')}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            Check out (fingerprint)
          </button>
        </div>

        <div className="mt-6 border-t border-[#1f5e3b]/10 pt-4">
          <h3 className="text-sm font-semibold text-[#1f5e3b]">Face scan</h3>
          <p className="mt-1 text-xs text-[#1f5e3b]/65">
            {bioHint?.faceEmbeddingActive
              ? 'AI face mode: open the camera, run live verify (blink + small head move), then punch. Photos are still resized for upload.'
              : 'Quick capture grabs one photo and closes the camera (fastest). Or open the camera and capture manually. Images are resized before upload for speed.'}
          </p>
          {bioHint && !bioHint.hasFace && (
            <p className="mt-2 text-xs text-amber-900">
              One-time face enrollment is on the{' '}
              <Link to="/identity" className="font-semibold underline">
                Identity
              </Link>{' '}
              page — this section is for daily attendance photos only.
            </p>
          )}
          {bioHint && bioHint.hasFace && (
            <p className="mt-2 text-xs text-[#1f5e3b]/75">
              Reference face is enrolled — capture here matches against it on the server (no re-enrollment from this
              screen).
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <div className="space-y-2">
              {!camOn ? (
                <div className="flex flex-wrap gap-2">
                  {!bioHint?.faceEmbeddingActive && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => quickFaceCapture()}
                      className="rounded-xl bg-gradient-to-r from-[#1f5e3b] to-[#2e7d32] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Quick capture
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={startCamera}
                    className="rounded-xl border border-[#1f5e3b]/25 bg-white px-4 py-2 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
                  >
                    Open camera
                  </button>
                </div>
              ) : (
                <>
                  <video ref={videoRef} playsInline muted className="max-h-48 rounded-xl border border-[#1f5e3b]/20" />
                  <div className="flex flex-wrap gap-2">
                    {bioHint?.faceEmbeddingActive ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => liveVerifyAndCapture()}
                        className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Live verify & capture
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={capturePreview}
                        className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Capture preview
                      </button>
                    )}
                    <button type="button" onClick={stopCamera} className="rounded-lg border border-[#1f5e3b]/20 px-3 py-1.5 text-xs text-[#1f5e3b]">
                      Close camera
                    </button>
                  </div>
                </>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>
            {previewUrl && (
              <div className="flex flex-col gap-2">
                <img src={previewUrl} alt="Preview" className="max-h-40 rounded-xl border border-[#1f5e3b]/15" />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => punchFace('in')}
                    className="rounded-lg bg-[#1f5e3b] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Check in (face)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => punchFace('out')}
                    className="rounded-lg border border-[#1f5e3b]/25 px-3 py-1.5 text-xs font-semibold text-[#1f5e3b] disabled:opacity-50"
                  >
                    Check out (face)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {punchMsg && <p className="mt-3 text-sm text-[#14261a]">{punchMsg}</p>}
      </div>

      <div className="ph-card rounded-2xl p-6">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">Status</span>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
            </select>
          </label>
          {canAll && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-[#1f5e3b]">Branch</span>
              <select value={filterBranchId} onChange={(e) => setFilterBranchId(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm">
                <option value="">All</option>
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name / employee id"
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={load}
            className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterStatus('')
              setFilterBranchId('')
              setSearch('')
            }}
            className="rounded-xl border border-[#1f5e3b]/20 bg-white px-4 py-2 text-sm font-semibold text-[#1f5e3b]"
          >
            Clear filters
          </button>
        </div>
        {err && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-red-600">{err}</p>
            <button type="button" onClick={load} className="text-sm font-semibold text-[#2e7d32] underline">
              Retry
            </button>
          </div>
        )}
        {loading ? (
          <p className="mt-4 text-sm text-[#1f5e3b]/70">Loading…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#1f5e3b]/10 text-[#1f5e3b]/80">
                  <th className="py-2 pr-3">Date</th>
                  {canAll && <th className="py-2 pr-3">Employee</th>}
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">In</th>
                  <th className="py-2 pr-3">Out</th>
                  <th className="py-2 pr-3">Total Hours</th>
                  <th className="py-2 pr-3">Late</th>
                  <th className="py-2">Photo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[#1f5e3b]/5">
                    <td className="py-2 pr-3">{r.work_date}</td>
                    {canAll && <td className="py-2 pr-3">{r.full_name || '—'}</td>}
                    <td className="py-2 pr-3 capitalize">{r.status}</td>
                    <td className="py-2 pr-3 text-xs text-[#14261a]/80">
                      {r.punch_in_at ? new Date(r.punch_in_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#14261a]/80">
                      {r.punch_out_at ? new Date(r.punch_out_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#14261a]/80">
                      {r.punch_in_at && r.punch_out_at
                        ? ((new Date(r.punch_out_at).getTime() - new Date(r.punch_in_at).getTime()) / 36e5).toFixed(2)
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs font-semibold">{String(r.status).toLowerCase() === 'late' ? 'Yes' : 'No'}</td>
                    <td className="py-2">
                      {r.punch_in_photo ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-[#2e7d32] underline"
                          onClick={() => window.open(r.punch_in_photo!, '_blank')}
                        >
                          View
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="mt-4 text-sm text-[#1f5e3b]/60">
                {search.trim() ? 'No attendance records match your search/filter.' : 'No records in selected range.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
