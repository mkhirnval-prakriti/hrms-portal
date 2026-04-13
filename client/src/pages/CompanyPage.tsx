import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { PageSkeleton } from '../components/PageSkeleton'
import { useState } from 'react'
type SheetStatus = {
  enabled: boolean
  mode: string
  google_sheet_link: string
  api_key: string
  default_webhook_url: string
  branch_map: Record<string, string>
  last_sync_at: string
  last_error: string
  branches: { id: number; name: string }[]
  snippet: string
  guide: string[]
}

export function CompanyPage() {
  const { user } = useAuth()
  const can = canPerm(user, 'settings:read')
  const isSuper = user?.role === 'SUPER_ADMIN'
  const [emails, setEmails] = useState('contact@prakritiherbs.in, mkhirnval@gmail.com')
  const [msg, setMsg] = useState('')
  const [sheetMsg, setSheetMsg] = useState('')
  const [sheetLink, setSheetLink] = useState('')
  const [webhook, setWebhook] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [branchMap, setBranchMap] = useState<Record<string, string>>({})
  const apkQ = useQuery({
    queryKey: ['mobile-apk'],
    queryFn: () => api<{ apk_url: string; note: string }>('/mobile/apk'),
    enabled: can,
  })

  const q = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => api<Record<string, unknown>>('/settings'),
    enabled: can,
    retry: 2,
    staleTime: 60_000,
  })
  const sheetQ = useQuery({
    queryKey: ['sheet-status'],
    queryFn: () => api<SheetStatus>('/integrations/sheets/status'),
    enabled: isSuper,
  })

  if (!can) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center text-sm text-[#1f5e3b]">
        Company settings are visible to HR / Admin roles.
      </div>
    )
  }
  async function saveDailyRecipients() {
    setMsg('')
    try {
      const list = emails
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      await api('/settings/daily-report', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true, recipients: list }),
      })
      setMsg('Daily report recipients updated.')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  async function connectSheet() {
    setSheetMsg('')
    try {
      await api('/integrations/sheets/connect', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: true,
          mode: 'webhook',
          google_sheet_link: sheetLink.trim(),
          default_webhook_url: webhook.trim(),
          api_key: apiKey.trim(),
          branch_map: branchMap,
        }),
      })
      setSheetMsg('Sheet integration connected.')
      await sheetQ.refetch()
    } catch (e) {
      setSheetMsg((e as Error).message)
    }
  }
  async function testConnection() {
    setSheetMsg('')
    try {
      await api('/integrations/sheets/test-connection', {
        method: 'POST',
        body: JSON.stringify({ webhook_url: webhook.trim() }),
      })
      setSheetMsg('Test connection successful.')
    } catch (e) {
      setSheetMsg((e as Error).message)
    }
  }
  async function manualSync() {
    setSheetMsg('')
    try {
      const r = await api<{ synced: number; failed: number }>('/integrations/sheets/manual-sync', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setSheetMsg(`Manual sync done. Synced: ${r.synced}, Failed: ${r.failed}`)
      await sheetQ.refetch()
    } catch (e) {
      setSheetMsg((e as Error).message)
    }
  }
  function copySnippet() {
    const text = sheetQ.data?.snippet || ''
    navigator.clipboard.writeText(text).then(() => setSheetMsg('Integration code copied.'))
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Company</h1>
      {q.error && (
        <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800">
          <p className="font-medium">Failed to load config</p>
          <p className="mt-1">{(q.error as Error).message}</p>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="mt-3 rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      )}
      {q.isLoading && <PageSkeleton rows={4} />}
      {q.data && !q.isLoading && (
        <>
          <div className="ph-card rounded-2xl p-6 text-sm">
            <pre className="overflow-x-auto whitespace-pre-wrap text-[#14261a]">{JSON.stringify(q.data, null, 2)}</pre>
          </div>
          {isSuper && (
            <div className="ph-card space-y-4 rounded-2xl p-6 text-sm">
              <h2 className="text-lg font-semibold text-[#1f5e3b]">Automation Controls (Super Admin)</h2>
              <label className="block">
                <span className="mb-1 block font-medium">Daily report emails (hidden from non-super-admin)</span>
                <input value={emails} onChange={(e) => setEmails(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveDailyRecipients} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Save recipients</button>
                <a href="/api/system/export.xlsx" className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">Download full export (Excel)</a>
                <a href="/api/system/export.pdf" className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">Download full export (PDF)</a>
                {apkQ.data?.apk_url && (
                  <a href={apkQ.data.apk_url} className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">Download HRMS APK</a>
                )}
              </div>
              {msg && <p className="text-xs text-[#1f5e3b]">{msg}</p>}
            </div>
          )}
          {isSuper && (
            <div className="ph-card space-y-4 rounded-2xl p-6 text-sm">
              <h2 className="text-lg font-semibold text-[#1f5e3b]">Excel / Google Sheet Integration (Super Admin)</h2>
              <label className="block">
                <span className="mb-1 block font-medium">Google Sheet Link (Option 1)</span>
                <input value={sheetLink} onChange={(e) => setSheetLink(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2" placeholder="https://docs.google.com/spreadsheets/..." />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">Webhook / API URL (Option 2)</span>
                <input value={webhook} onChange={(e) => setWebhook(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2" placeholder="https://script.google.com/macros/s/..." />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">API Key (optional)</span>
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
              </label>
              <div>
                <p className="mb-2 font-medium">Branch-wise sheet/webhook mapping</p>
                <div className="space-y-2">
                  {(sheetQ.data?.branches || []).map((b) => (
                    <div key={b.id} className="grid gap-2 sm:grid-cols-[160px,1fr]">
                      <span className="rounded-lg bg-[#f5faf6] px-3 py-2 text-xs font-semibold text-[#1f5e3b]">{b.name}</span>
                      <input
                        value={branchMap[String(b.id)] || ''}
                        onChange={(e) => setBranchMap((prev) => ({ ...prev, [String(b.id)]: e.target.value }))}
                        className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs"
                        placeholder={`Webhook for ${b.name}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={connectSheet} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Connect Sheet</button>
                <button type="button" onClick={copySnippet} className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">Copy Integration Code</button>
                <button type="button" onClick={testConnection} className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">Test Connection</button>
                <button type="button" onClick={manualSync} className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">Manual Sync</button>
              </div>
              <p className="text-xs text-[#1f5e3b]/80">Sirf code copy karke Google Sheet script me paste karein. Manual coding ki zarurat nahi hai.</p>
              {sheetQ.data?.snippet && <pre className="overflow-x-auto rounded-xl bg-[#0f172a] p-3 text-xs text-[#e2e8f0]">{sheetQ.data.snippet}</pre>}
              {sheetQ.data?.guide?.length ? (
                <ol className="list-decimal space-y-1 pl-5 text-xs text-[#1f5e3b]/85">
                  {sheetQ.data.guide.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ol>
              ) : null}
              <div className="text-xs text-[#1f5e3b]/80">
                Status: {sheetQ.data?.enabled ? 'Connected' : 'Not connected'}{' '}
                {sheetQ.data?.last_sync_at ? `| Last sync: ${new Date(sheetQ.data.last_sync_at).toLocaleString()}` : ''}
                {sheetQ.data?.last_error ? `| Last error: ${sheetQ.data.last_error}` : ''}
              </div>
              {sheetMsg && <p className="text-xs text-[#1f5e3b]">{sheetMsg}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
