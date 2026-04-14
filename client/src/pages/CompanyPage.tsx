import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { PageSkeleton } from '../components/PageSkeleton'
import { useEffect, useState } from 'react'
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
type CompanyProfile = {
  company_name: string
  legal_name?: string
  gstin: string
  cin: string
  email: string
  address: string
  legal_address?: string
  city: string
  state: string
  pincode: string
  authorized_signatory?: string
  director?: string
}
type WifiNetwork = { ssid: string; password: string }
type CustomRole = { id: number; name: string; permissions?: string[]; active: number }

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
  const [modules, setModules] = useState<Record<string, boolean>>({
    attendance: true,
    leave: true,
    kiosk: true,
    staff: true,
    documents: true,
    payroll: true,
    notices: true,
  })
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [profile, setProfile] = useState<CompanyProfile>({
    company_name: 'PRAKRITI HERBS PRIVATE LIMITED',
    legal_name: 'PRAKRITI HERBS PRIVATE LIMITED',
    gstin: '08AAQCP4095D1Z2',
    cin: 'U46497RJ2025PTC109202',
    email: 'contact@prakritiherbs.in',
    address: 'Building No. 30 & 31, South Part, Bilochi Nagar A, Amer, Jaipur, Rajasthan - 302012',
    legal_address: 'Building No. 30 & 31, South Part, Bilochi Nagar A, Amer, Jaipur, Rajasthan - 302012',
    city: 'Jaipur',
    state: 'Rajasthan',
    pincode: '302012',
    authorized_signatory: 'Mandeep Kumar',
    director: 'Mandeep Kumar',
  })
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([])
  const [wifiEnabled, setWifiEnabled] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRolePerms, setNewRolePerms] = useState('')
  const [assignRoleId, setAssignRoleId] = useState('')
  const [assignUserId, setAssignUserId] = useState('')
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
  const companyQ = useQuery({
    queryKey: ['company-profile'],
    queryFn: () => api<{ profile: CompanyProfile }>('/company/profile'),
    enabled: can,
  })
  const wifiQ = useQuery({
    queryKey: ['wifi-config'],
    queryFn: () => api<{ enabled: boolean; networks: WifiNetwork[] }>('/attendance/wifi-config'),
    enabled: isSuper,
  })
  const customRolesQ = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => api<{ roles: CustomRole[] }>('/roles/custom'),
    enabled: isSuper,
  })

  useEffect(() => {
    const f = (q.data?.features || {}) as Record<string, boolean>
    if (Object.keys(f).length > 0) {
      setModules((prev) => ({ ...prev, ...f }))
    }
  }, [q.data])

  useEffect(() => {
    if (sheetQ.data) setSyncEnabled(!!sheetQ.data.enabled)
  }, [sheetQ.data])
  useEffect(() => {
    if (companyQ.data?.profile) setProfile(companyQ.data.profile)
  }, [companyQ.data])
  useEffect(() => {
    if (wifiQ.data) {
      setWifiEnabled(!!wifiQ.data.enabled)
      setWifiNetworks(Array.isArray(wifiQ.data.networks) ? wifiQ.data.networks : [])
    }
  }, [wifiQ.data])

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

  async function saveModules() {
    setMsg('')
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ features: modules }),
      })
      setMsg('Module configuration saved.')
      await q.refetch()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  async function updateSyncToggle(enabled: boolean) {
    setSheetMsg('')
    try {
      await api('/integrations/sheets/connect', {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      })
      setSyncEnabled(enabled)
      setSheetMsg(enabled ? 'Auto sync enabled.' : 'Auto sync disabled.')
      await sheetQ.refetch()
    } catch (e) {
      setSheetMsg((e as Error).message)
    }
  }
  async function saveCompanyProfile() {
    setMsg('')
    try {
      await api('/company/profile', {
        method: 'PATCH',
        body: JSON.stringify(profile),
      })
      setMsg('Company profile saved.')
      await companyQ.refetch()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  async function saveWifiConfig() {
    setMsg('')
    try {
      await api('/attendance/wifi-config', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: wifiEnabled, networks: wifiNetworks }),
      })
      setMsg('Attendance WiFi config saved.')
      await wifiQ.refetch()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  async function createRole() {
    setMsg('')
    try {
      const permissions = newRolePerms.split(',').map((x) => x.trim()).filter(Boolean)
      await api('/roles/custom', { method: 'POST', body: JSON.stringify({ name: newRoleName.trim(), permissions }) })
      setNewRoleName('')
      setNewRolePerms('')
      setMsg('Custom role created.')
      await customRolesQ.refetch()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  async function assignRoleToUser() {
    setMsg('')
    try {
      await api(`/roles/custom/${Number(assignRoleId)}/assign-user`, {
        method: 'POST',
        body: JSON.stringify({ user_id: Number(assignUserId) }),
      })
      setMsg('Custom role assigned to user.')
    } catch (e) {
      setMsg((e as Error).message)
    }
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
          {isSuper && (
            <div className="ph-card space-y-4 rounded-2xl p-6 text-sm">
              <h2 className="text-lg font-semibold text-[#1f5e3b]">Company Profile (Auto-fill + Editable)</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={profile.legal_name || ''} onChange={(e) => setProfile((p) => ({ ...p, legal_name: e.target.value, company_name: e.target.value }))} placeholder="Legal Name" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.gstin || ''} onChange={(e) => setProfile((p) => ({ ...p, gstin: e.target.value }))} placeholder="GSTIN" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.cin || ''} onChange={(e) => setProfile((p) => ({ ...p, cin: e.target.value }))} placeholder="CIN" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.email || ''} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} placeholder="Company Email" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.authorized_signatory || ''} onChange={(e) => setProfile((p) => ({ ...p, authorized_signatory: e.target.value, director: e.target.value }))} placeholder="Authorised Signatory" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.pincode || ''} onChange={(e) => setProfile((p) => ({ ...p, pincode: e.target.value }))} placeholder="Pincode" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.city || ''} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} placeholder="City" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.state || ''} onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))} placeholder="State" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2" />
                <input value={profile.legal_address || profile.address || ''} onChange={(e) => setProfile((p) => ({ ...p, legal_address: e.target.value, address: e.target.value }))} placeholder="Full Address" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 sm:col-span-2" />
              </div>
              <button type="button" onClick={saveCompanyProfile} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Save company profile</button>
            </div>
          )}
          {isSuper && (
            <div className="ph-card space-y-4 rounded-2xl p-6 text-sm">
              <h2 className="text-lg font-semibold text-[#1f5e3b]">Attendance Controls (Face/Fingerprint/GPS/WiFi)</h2>
              <p className="text-xs text-[#1f5e3b]/75">Face/Fingerprint/GPS can be controlled per user in Staff edit. WiFi is global policy below.</p>
              <label className="flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={wifiEnabled} onChange={(e) => setWifiEnabled(e.target.checked)} />
                Enable WiFi attendance restriction
              </label>
              <div className="space-y-2">
                {wifiNetworks.map((n, i) => (
                  <div key={`${n.ssid}-${i}`} className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                    <input value={n.ssid} onChange={(e) => setWifiNetworks((prev) => prev.map((x, idx) => idx === i ? { ...x, ssid: e.target.value } : x))} placeholder="SSID" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
                    <input value={n.password} onChange={(e) => setWifiNetworks((prev) => prev.map((x, idx) => idx === i ? { ...x, password: e.target.value } : x))} placeholder="Password" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
                    <button type="button" onClick={() => setWifiNetworks((prev) => prev.filter((_, idx) => idx !== i))} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">Delete</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setWifiNetworks((prev) => [...prev, { ssid: '', password: '' }])} className="rounded-lg border border-[#1f5e3b]/20 px-3 py-2 text-xs font-semibold text-[#1f5e3b]">Add SSID</button>
                <button type="button" onClick={saveWifiConfig} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Save WiFi config</button>
              </div>
            </div>
          )}
          {isSuper && (
            <div className="ph-card space-y-4 rounded-2xl p-6 text-sm">
              <h2 className="text-lg font-semibold text-[#1f5e3b]">Super Admin Role Control</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Role name" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
                <input value={newRolePerms} onChange={(e) => setNewRolePerms(e.target.value)} placeholder="Permissions (comma separated)" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
              </div>
              <button type="button" onClick={createRole} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Create role</button>
              <div className="space-y-2">
                {(customRolesQ.data?.roles || []).map((r) => (
                  <div key={r.id} className="rounded-lg border border-[#1f5e3b]/15 px-3 py-2 text-xs">
                    <p className="font-semibold">{r.name}</p>
                    <p className="mt-1 text-[#1f5e3b]/75">{(r.permissions || []).join(', ') || 'No permissions'}</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={async () => { await api(`/roles/custom/${r.id}`, { method: 'PATCH', body: JSON.stringify({ active: r.active ? 0 : 1 }) }); await customRolesQ.refetch() }} className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 font-semibold text-[#1f5e3b]">{r.active ? 'Disable' : 'Enable'}</button>
                      <button type="button" onClick={async () => { await api(`/roles/custom/${r.id}`, { method: 'PATCH', body: JSON.stringify({ permissions: newRolePerms.split(',').map((x) => x.trim()).filter(Boolean) }) }); await customRolesQ.refetch() }} className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 font-semibold text-[#1f5e3b]">Update perms from input</button>
                      <button type="button" onClick={async () => { await api(`/roles/custom/${r.id}`, { method: 'DELETE' }); await customRolesQ.refetch() }} className="rounded-lg border border-red-300 px-2 py-1 font-semibold text-red-700">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={assignRoleId} onChange={(e) => setAssignRoleId(e.target.value)} placeholder="Role ID" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
                <input value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} placeholder="User ID" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-xs" />
                <button type="button" onClick={assignRoleToUser} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">Assign role</button>
              </div>
            </div>
          )}
          {isSuper && (
            <div className="ph-card space-y-4 rounded-2xl p-6 text-sm">
              <h2 className="text-lg font-semibold text-[#1f5e3b]">Config Panel (Modules)</h2>
              <p className="text-xs text-[#1f5e3b]/75">Business modules ko ON/OFF karke UI + feature access control kar sakte hain.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.keys(modules).map((k) => (
                  <label key={k} className="flex items-center justify-between rounded-lg border border-[#1f5e3b]/15 px-3 py-2">
                    <span className="text-xs font-medium capitalize">{k}</span>
                    <input
                      type="checkbox"
                      checked={!!modules[k]}
                      onChange={(e) => setModules((prev) => ({ ...prev, [k]: e.target.checked }))}
                    />
                  </label>
                ))}
              </div>
              <button type="button" onClick={saveModules} className="rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">
                Save module config
              </button>
            </div>
          )}
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
                <button type="button" onClick={() => updateSyncToggle(!syncEnabled)} className="rounded-lg border border-[#1f5e3b]/20 px-4 py-2 text-xs font-semibold text-[#1f5e3b]">
                  Sync {syncEnabled ? 'OFF' : 'ON'}
                </button>
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
