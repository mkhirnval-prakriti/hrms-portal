import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { captureVideoFrameToJpegBlob, getFaceCameraConstraints } from '../lib/faceCapture'
import { descriptorToJson, runLivenessAndFaceDescriptor } from '../lib/faceApiLiveness'
import {
  browserSupportsWebAuthn,
  deleteWebAuthnCredential,
  fetchWebAuthnAttendanceStatus,
  listWebAuthnCredentials,
  registerNewPasskey,
  type ListedWebAuthnCred,
  type WebAuthnAttendanceStatus,
} from '../lib/webauthnAttendance'

type BioPending = { id: number; created_at: string } | null
type BioApproved = { id: number; approval_expires_at: string | null } | null

type BioStatus = {
  hasFace: boolean
  faceEmbeddingActive?: boolean
  webauthnCount: number
  pending: { face: BioPending; biometric: BioPending }
  approvedAwaitingEnrollment: { face: BioApproved; biometric: BioApproved }
  canRequestFaceUpdate: boolean
  canRequestBiometricUpdate: boolean
  blockReasonFace?: string
  blockReasonBiometric?: string
}

type MineReq = {
  id: number
  kind: string
  status: string
  created_at: string
  reject_reason: string | null
  approval_expires_at: string | null
  completed_at: string | null
}

export function IdentityEnrollmentPage() {
  const { user } = useAuth()
  const [bio, setBio] = useState<BioStatus | null>(null)
  const [mine, setMine] = useState<MineReq[]>([])
  const [wa, setWa] = useState<WebAuthnAttendanceStatus | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [camOn, setCamOn] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [faceBlob, setFaceBlob] = useState<Blob | null>(null)
  const [faceDescriptorJson, setFaceDescriptorJson] = useState<string | null>(null)
  const [passLabel, setPassLabel] = useState('')
  const [creds, setCreds] = useState<ListedWebAuthnCred[]>([])

  const isAdmin = canPerm(user, 'biometric:admin')
  const canRequest = canPerm(user, 'biometric:request_update')

  const refresh = useCallback(async () => {
    setMsg(null)
    try {
      const [b, w, m] = await Promise.all([
        api<BioStatus>('/biometric/status'),
        fetchWebAuthnAttendanceStatus().catch(() => null),
        api<{ requests: MineReq[] }>('/biometric/requests/mine').catch(() => ({ requests: [] })),
      ])
      setBio(b)
      setWa(w)
      setMine(m.requests || [])
      if (w && w.credCount > 0) {
        setCreds(await listWebAuthnCredentials().catch(() => []))
      } else {
        setCreds([])
      }
    } catch (e) {
      setMsg((e as Error).message || 'Failed to load status')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function startCamera() {
    setMsg(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia(getFaceCameraConstraints())
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamOn(true)
    } catch {
      setMsg('Camera access denied or unavailable.')
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

  async function liveCheckAndCapture() {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || !v.videoWidth) return
    setBusy(true)
    setMsg(null)
    try {
      const desc = await runLivenessAndFaceDescriptor(v)
      setFaceDescriptorJson(descriptorToJson(desc))
      const blob = await captureVideoFrameToJpegBlob(v, c)
      if (blob) {
        setFaceBlob(blob)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(URL.createObjectURL(blob))
        setMsg('Live check passed — save when ready.')
      } else {
        setFaceDescriptorJson(null)
        setMsg('Could not build photo — try again.')
      }
    } catch (e) {
      setFaceDescriptorJson(null)
      setMsg((e as Error).message || 'Live check failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitFace(approvalRequestId?: number) {
    if (!user || !faceBlob || faceBlob.size < 8192) {
      setMsg('Capture a clear photo (min ~8KB).')
      return
    }
    if (!faceDescriptorJson) {
      setMsg('Run “Live check & capture” first so the AI embedding can be stored.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('photo', faceBlob, 'face.jpg')
      fd.append('faceDescriptor', faceDescriptorJson)
      if (approvalRequestId != null) fd.append('approvalRequestId', String(approvalRequestId))
      await api(`/users/${user.id}/face-enrollment`, { method: 'POST', body: fd })
      setMsg('Face profile saved.')
      setFaceBlob(null)
      setFaceDescriptorJson(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      stopCamera()
      await refresh()
    } catch (e) {
      setMsg((e as Error).message || 'Face enrollment failed')
    } finally {
      setBusy(false)
    }
  }

  async function requestKind(kind: 'face' | 'biometric') {
    setBusy(true)
    setMsg(null)
    try {
      await api('/biometric/requests', { method: 'POST', body: JSON.stringify({ kind }) })
      setMsg('Request submitted. A manager will review it.')
      await refresh()
    } catch (e) {
      setMsg((e as Error).message || 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRequest(id: number) {
    setBusy(true)
    setMsg(null)
    try {
      await api(`/biometric/requests/${id}/cancel`, { method: 'POST', body: '{}' })
      setMsg('Request cancelled.')
      await refresh()
    } catch (e) {
      setMsg((e as Error).message || 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  async function registerPasskey(approvalRequestId?: number) {
    setBusy(true)
    setMsg(null)
    try {
      await registerNewPasskey(passLabel, approvalRequestId)
      setMsg('Passkey registered.')
      setPassLabel('')
      await refresh()
    } catch (e) {
      setMsg((e as Error).message || 'Passkey registration failed')
    } finally {
      setBusy(false)
    }
  }

  const apprFace = bio?.approvedAwaitingEnrollment?.face
  const apprBio = bio?.approvedAwaitingEnrollment?.biometric

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Identity & biometrics</h1>
        <p className="mt-1 text-sm text-[#1f5e3b]/75">
          Face and passkeys are enrolled once. Further changes need manager approval (or HR can update you directly).
          WebAuthn uses your device PIN or biometrics per OS policy — raw fingerprints are not uploaded.
        </p>
      </div>

      {isAdmin && (
        <div className="rounded-2xl border border-[#2e7d32]/30 bg-[#e8f5e9] p-4 text-sm text-[#14261a]">
          You can approve staff requests and use direct reset tools on the{' '}
          <Link to="/biometric-requests" className="font-semibold text-[#1f5e3b] underline">
            Biometric requests
          </Link>{' '}
          page.
        </div>
      )}

      {msg && <p className="rounded-xl bg-white p-3 text-sm text-[#14261a] shadow-sm ring-1 ring-[#1f5e3b]/10">{msg}</p>}

      {wa && (
        <p className="text-xs text-[#1f5e3b]/70">
          Attendance WebAuthn policy: <span className="font-semibold">{wa.mode}</span> · Passkeys on file:{' '}
          <span className="font-semibold">{wa.credCount}</span>
        </p>
      )}

      <div className="ph-card space-y-4 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Face (attendance matching)</h2>
        <p className="text-xs text-[#1f5e3b]/70">
          Status:{' '}
          <span className="font-semibold">{bio?.hasFace ? 'Enrolled' : 'Not enrolled yet'}</span>
          {bio?.faceEmbeddingActive ? (
            <span className="ml-1 font-semibold text-[#2e7d32]">· AI embedding active</span>
          ) : (
            <span className="ml-1 text-[#1f5e3b]/60">· legacy photo match until you re-save with live check</span>
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          {!bio?.hasFace && (
            <span className="text-xs font-semibold uppercase tracking-wide text-[#2e7d32]">First-time register</span>
          )}
          {bio?.hasFace && canRequest && (
            <button
              type="button"
              disabled={busy || !bio.canRequestFaceUpdate}
              title={bio.blockReasonFace}
              onClick={() => requestKind('face')}
              className="rounded-xl border border-[#1f5e3b]/25 px-4 py-2 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
            >
              Request face update
            </button>
          )}
        </div>

        {apprFace && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-950">
            <p className="font-semibold">Approved — complete face update</p>
            <p className="mt-1 text-xs">
              Expires: {apprFace.approval_expires_at ? new Date(apprFace.approval_expires_at).toLocaleString() : '—'}
            </p>
          </div>
        )}

        {(!bio?.hasFace || apprFace) && (
          <div className="space-y-3 border-t border-[#1f5e3b]/10 pt-4">
            <p className="text-xs text-[#1f5e3b]/70">
              Open the camera, run <span className="font-semibold">Live check & capture</span> (blink once + small head
              move), then save. This stores a 128-D embedding for attendance matching.
            </p>
            {!camOn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => startCamera().catch(() => setMsg('Camera unavailable.'))}
                className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white"
              >
                Open camera
              </button>
            ) : (
              <div className="flex flex-wrap gap-3">
                <video ref={videoRef} playsInline muted className="max-h-48 rounded-xl border border-[#1f5e3b]/20" />
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => liveCheckAndCapture()}
                    className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Live check & capture
                  </button>
                  <button type="button" onClick={stopCamera} className="rounded-lg border border-[#1f5e3b]/20 px-3 py-1.5 text-xs text-[#1f5e3b]">
                    Close camera
                  </button>
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
            {previewUrl && <img src={previewUrl} alt="" className="max-h-40 rounded-xl border border-[#1f5e3b]/15" />}
            <button
              type="button"
              disabled={busy || !faceBlob || !faceDescriptorJson}
              onClick={() => submitFace(apprFace?.id)}
              className="rounded-xl bg-gradient-to-r from-[#1f5e3b] to-[#2e7d32] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {bio?.hasFace ? 'Save new face (approved update)' : 'Register face'}
            </button>
          </div>
        )}
      </div>

      <div className="ph-card space-y-4 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Passkey (WebAuthn)</h2>
        <p className="text-xs text-[#1f5e3b]/70">
          Registered passkeys: <span className="font-semibold">{bio?.webauthnCount ?? 0}</span>
        </p>
        {!browserSupportsWebAuthn() && (
          <p className="text-xs font-medium text-amber-900">This browser does not support WebAuthn.</p>
        )}

        {bio && bio.webauthnCount === 0 && browserSupportsWebAuthn() && (
          <div>
            <label className="text-xs font-medium text-[#1f5e3b]">Label (optional)</label>
            <input
              value={passLabel}
              onChange={(e) => setPassLabel(e.target.value)}
              className="mt-1 w-full max-w-md rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              placeholder="e.g. Phone"
              maxLength={120}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => registerPasskey()}
              className="mt-2 rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Register passkey
            </button>
          </div>
        )}

        {bio && bio.webauthnCount > 0 && canRequest && (
          <button
            type="button"
            disabled={busy || !bio.canRequestBiometricUpdate}
            title={bio.blockReasonBiometric}
            onClick={() => requestKind('biometric')}
            className="rounded-xl border border-[#1f5e3b]/25 px-4 py-2 text-sm font-semibold text-[#1f5e3b] disabled:opacity-50"
          >
            Request passkey update
          </button>
        )}

        {apprBio && browserSupportsWebAuthn() && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
            <p className="font-semibold">Approved — register replacement passkey</p>
            <p className="mt-1 text-xs">
              Expires: {apprBio.approval_expires_at ? new Date(apprBio.approval_expires_at).toLocaleString() : '—'}
            </p>
            <input
              value={passLabel}
              onChange={(e) => setPassLabel(e.target.value)}
              className="mt-2 w-full max-w-md rounded-xl border border-amber-300/60 bg-white px-3 py-2 text-sm"
              placeholder="New passkey label"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => registerPasskey(apprBio.id)}
              className="mt-2 rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Complete passkey update
            </button>
          </div>
        )}

        {creds.length > 0 && (
          <ul className="space-y-2 border-t border-[#1f5e3b]/10 pt-3 text-sm">
            {creds.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#1f5e3b]/5 px-3 py-2">
                <span>
                  <span className="font-medium">{c.device_label || 'Passkey'}</span>
                  <span className="ml-2 text-xs text-[#1f5e3b]/70">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                </span>
                {user?.role !== 'USER' || creds.length > 1 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await deleteWebAuthnCredential(c.id)
                        setMsg('Passkey removed.')
                        await refresh()
                      } catch (e) {
                        setMsg((e as Error).message)
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="text-xs font-semibold text-red-700 underline"
                  >
                    Remove
                  </button>
                ) : (
                  <span className="text-xs text-[#1f5e3b]/60">Staff cannot remove their only passkey here.</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ph-card rounded-2xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1f5e3b]/80">My requests</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-[#1f5e3b]/60">No recent requests.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1f5e3b]/10 px-3 py-2">
                <span>
                  <span className="font-medium capitalize">{r.kind}</span> · {r.status}
                  {r.reject_reason ? <span className="ml-2 text-red-700">({r.reject_reason})</span> : null}
                </span>
                {r.status === 'pending' && (
                  <button type="button" disabled={busy} onClick={() => cancelRequest(r.id)} className="text-xs font-semibold text-[#1f5e3b] underline">
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-center text-sm">
        <Link to="/attendance" className="font-semibold text-[#2e7d32] underline">
          Back to Attendance
        </Link>
      </p>
    </div>
  )
}
