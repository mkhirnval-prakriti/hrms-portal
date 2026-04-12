import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type DocRow = {
  id: number
  user_id: number
  doc_type: string
  file_name: string
  file_path: string
  verified: number
  user_name?: string
}

export function DocumentsPage() {
  const { user } = useAuth()
  const [docs, setDocs] = useState<DocRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState('aadhaar')
  const [busy, setBusy] = useState(false)

  const canVerify = canPerm(user, 'documents:verify')
  const canAll = canPerm(user, 'documents:read_all')

  async function load() {
    setErr(null)
    setLoading(true)
    try {
      const d = await api<{ documents: DocRow[] }>('/documents')
      setDocs(d.documents || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('doc_type', docType)
      await api('/documents', { method: 'POST', body: fd })
      setFile(null)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function verify(id: number, verified: boolean) {
    setErr(null)
    try {
      await api(`/documents/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ verified, verifier_notes: verified ? 'Verified in HRMS' : 'Unverified' }),
      })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Document compliance</h1>
        <p className="text-sm text-[#1f5e3b]/70">
          Upload KYC documents {canAll ? '(team)' : '(your profile)'}; HR can verify records.
        </p>
      </div>

      <form onSubmit={upload} className="ph-card space-y-4 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-[#1f5e3b]">Upload</h2>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Type</span>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
            >
              <option value="aadhaar">Aadhaar</option>
              <option value="pan">PAN</option>
              <option value="contract">Contract</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">File (PDF / image)</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || !file}
          className="rounded-xl bg-[#1f5e3b] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Upload
        </button>
      </form>

      <div className="ph-card rounded-2xl p-6">
        <div className="flex justify-between">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Documents</h2>
          <button type="button" onClick={load} className="text-sm text-[#1f5e3b] underline">
            Refresh
          </button>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="mt-4 text-sm">Loading…</p>
        ) : (
          <div className="mt-4 space-y-3">
            {docs.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1f5e3b]/10 bg-white/90 p-4 text-sm"
              >
                <div>
                  <p className="font-semibold capitalize text-[#14261a]">
                    {d.doc_type} · {d.file_name}
                  </p>
                  {canAll && d.user_name && (
                    <p className="text-xs text-[#1f5e3b]/75">Employee: {d.user_name}</p>
                  )}
                  <p className="text-xs text-[#14261a]/70">
                    Status: {Number(d.verified) === 1 ? 'Verified' : 'Pending review'}
                  </p>
                  <a
                    href={d.file_path}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-semibold text-[#2e7d32] underline"
                  >
                    Open file
                  </a>
                </div>
                {canVerify && (
                  <div className="flex gap-2">
                    {Number(d.verified) !== 1 && (
                      <button
                        type="button"
                        onClick={() => verify(d.id, true)}
                        className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Mark verified
                      </button>
                    )}
                    {Number(d.verified) === 1 && (
                      <button
                        type="button"
                        onClick={() => verify(d.id, false)}
                        className="rounded-lg border border-[#8d6e63]/40 px-3 py-1.5 text-xs text-[#5d4037]"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {docs.length === 0 && <p className="text-sm text-[#1f5e3b]/60">No documents yet.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
