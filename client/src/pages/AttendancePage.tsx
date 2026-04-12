import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiFetchUrl, getToken } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { localDateStr } from '../lib/date'

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
  const [filterMethod, setFilterMethod] = useState<string>('')
  const [filterPhoto, setFilterPhoto] = useState<'all' | 'with' | 'without'>('all')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [camOn, setCamOn] = useState(false)
  const [faceBlob, setFaceBlob] = useState<Blob | null>(null)

  const today = localDateStr()
  const canAll = canPerm(user, 'history:read')

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      const data = await api<{ records: AttRow[] }>('/attendance/history' + q)
      setRecords(data.records || [])
    } catch (e) {
      setErr((e as Error).message)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

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
  if (filterMethod) {
    filtered = filtered.filter(
      (r) => r.punch_method_in === filterMethod || r.punch_method_out === filterMethod
    )
  }
  if (filterPhoto === 'with') {
    filtered = filtered.filter((r) => !!r.punch_in_photo)
  } else if (filterPhoto === 'without') {
    filtered = filtered.filter((r) => !r.punch_in_photo)
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
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      setPunchMsg(kind === 'in' ? 'Checked in successfully.' : 'Checked out successfully.')
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamOn(true)
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
  }

  function capturePreview() {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || !v.videoWidth) return
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    c.toBlob(
      (b) => {
        if (b) {
          setFaceBlob(b)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(URL.createObjectURL(b))
        }
      },
      'image/jpeg',
      0.88
    )
  }

  async function punchFace(kind: 'in' | 'out') {
    if (!faceBlob || faceBlob.size < 8192) {
      setPunchMsg('Capture a clearer photo (min ~8KB) using Face scan.')
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
      if (user?.branch_id) fd.append('useBranchCenter', 'true')
      fd.append('photo', faceBlob, 'face.jpg')
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
      setPunchMsg(kind === 'in' ? 'Checked in with face.' : 'Checked out with face.')
      setFaceBlob(null)
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

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Attendance</h1>
        <p className="text-sm text-[#1f5e3b]/70">
          Choose GPS, office location, face capture, or fingerprint (device-ready). Photo history appears in the
          table below.
        </p>
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
          <p className="mt-1 text-xs text-[#1f5e3b]/65">Open camera, capture preview, then check in/out with photo.</p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <div className="space-y-2">
              {!camOn ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white"
                >
                  Open camera
                </button>
              ) : (
                <>
                  <video ref={videoRef} playsInline muted className="max-h-48 rounded-xl border border-[#1f5e3b]/20" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={capturePreview} className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white">
                      Capture preview
                    </button>
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
            <span className="mb-1 block font-medium text-[#1f5e3b]">Method</span>
            <select
              value={filterMethod}
              onChange={(e) => setFilterMethod(e.target.value)}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="gps">GPS</option>
              <option value="office">Office</option>
              <option value="face">Face</option>
              <option value="fingerprint">Fingerprint</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-[#1f5e3b]">Photo</span>
            <select
              value={filterPhoto}
              onChange={(e) => setFilterPhoto(e.target.value as 'all' | 'with' | 'without')}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="with">With check-in photo</option>
              <option value="without">Without photo</option>
            </select>
          </label>
          <button
            type="button"
            onClick={load}
            className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white"
          >
            Refresh
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
                  <th className="py-2 pr-3">Method</th>
                  <th className="py-2 pr-3">In</th>
                  <th className="py-2 pr-3">Out</th>
                  <th className="py-2">Photo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[#1f5e3b]/5">
                    <td className="py-2 pr-3">{r.work_date}</td>
                    {canAll && <td className="py-2 pr-3">{r.full_name || '—'}</td>}
                    <td className="py-2 pr-3 capitalize">{r.status}</td>
                    <td className="py-2 pr-3 text-xs">
                      {r.punch_method_in || '—'}
                      {r.verification_in ? ` (${r.verification_in})` : ''}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#14261a]/80">
                      {r.punch_in_at ? new Date(r.punch_in_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#14261a]/80">
                      {r.punch_out_at ? new Date(r.punch_out_at).toLocaleString() : '—'}
                    </td>
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
            {filtered.length === 0 && <p className="mt-4 text-sm text-[#1f5e3b]/60">No records in range.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
