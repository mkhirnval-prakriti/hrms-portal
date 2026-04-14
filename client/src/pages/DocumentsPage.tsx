import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { PageSkeleton } from '../components/PageSkeleton'

type DocRow = {
  id: number
  user_id: number
  doc_type: string
  file_name: string
  file_path: string
  verified: number
  doc_status?: 'pending' | 'approved' | 'rejected'
  user_name?: string
}

const docsKey = ['documents', 'list'] as const

export function DocumentsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState('aadhaar')
  const [search, setSearch] = useState('')

  const canVerify = canPerm(user, 'documents:verify')
  const canAll = canPerm(user, 'documents:read_all')

  const listQ = useQuery({
    queryKey: docsKey,
    queryFn: async () => {
      const d = await api<{ documents: DocRow[] }>('/documents')
      return d.documents || []
    },
    retry: 2,
    staleTime: 30_000,
  })

  const uploadMut = useMutation({
    mutationFn: async (payload: { file: File; doc_type: string }) => {
      const fd = new FormData()
      fd.append('file', payload.file)
      fd.append('doc_type', payload.doc_type)
      await api('/documents', { method: 'POST', body: fd })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: docsKey }),
  })

  const verifyMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'approved' | 'rejected' | 'pending' }) => {
      await api(`/documents/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ status, verifier_notes: status === 'approved' ? 'Approved in HRMS' : 'Rejected in HRMS' }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: docsKey }),
  })

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    uploadMut.mutate({ file, doc_type: docType })
    setFile(null)
  }

  const docs = (listQ.data ?? []).filter((d) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${d.doc_type} ${d.file_name} ${d.user_name || ''} ${d.user_id}`.toLowerCase().includes(q)
  })
  const pendingCount = docs.filter((d) => (d.doc_status || 'pending') === 'pending').length

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
        {uploadMut.error && (
          <p className="text-sm text-red-600">{(uploadMut.error as Error).message}</p>
        )}
        <button
          type="submit"
          disabled={uploadMut.isPending || !file}
          className="rounded-xl bg-[#1f5e3b] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {uploadMut.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      <div className="ph-card rounded-2xl p-6">
        <div className="flex justify-between">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Documents {canVerify ? `(Pending: ${pendingCount})` : ''}</h2>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name / employee id / file / type"
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={() => listQ.refetch()}
              className="text-sm text-[#1f5e3b] underline"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]"
            >
              Clear
            </button>
          </div>
        </div>
        {listQ.error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800">
            <p className="font-medium">Failed to load documents</p>
            <p className="mt-1">{(listQ.error as Error).message}</p>
            <button
              type="button"
              onClick={() => listQ.refetch()}
              className="mt-3 rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white"
            >
              Retry
            </button>
          </div>
        )}
        {listQ.isLoading && <PageSkeleton rows={5} />}
        {!listQ.isLoading && !listQ.error && (
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
                    Status: {(d.doc_status || (Number(d.verified) === 1 ? 'approved' : 'pending')).toUpperCase()}
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
                    {(d.doc_status || 'pending') !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => verifyMut.mutate({ id: d.id, status: 'approved' })}
                        disabled={verifyMut.isPending}
                        className="rounded-lg bg-[#2e7d32] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                    )}
                    {(d.doc_status || 'pending') !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() => verifyMut.mutate({ id: d.id, status: 'rejected' })}
                        disabled={verifyMut.isPending}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {docs.length === 0 && (
              <p className="text-sm text-[#1f5e3b]/60">
                {search.trim() ? 'No documents match your search.' : 'No documents yet.'}
              </p>
            )}
          </div>
        )}
        {verifyMut.error && (
          <p className="mt-3 text-sm text-red-600">{(verifyMut.error as Error).message}</p>
        )}
      </div>
    </div>
  )
}
