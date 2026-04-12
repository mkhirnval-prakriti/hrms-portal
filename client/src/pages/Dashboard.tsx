import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'

type AlertRow = {
  id: number
  type: string
  severity: string
  message: string
  created_at: string
  user_name?: string
}

type Overview = {
  today: {
    date: string
    totalStaff: number
    present: number
    late: number
    absent: number
    onLeave?: number
    halfDay?: number
    presentOnly?: number
    punchInCount?: number
    punchOutCount?: number
    totalMinutesWorked?: number
    totalHoursWorkedToday?: number
  }
  stats: {
    workforce: number
    monthlyBudgetINR: number
    workHours: number
    offices: number
    totalMinutesWorkedMonth?: number
    totalHoursWorkedMonth?: number
  }
  alerts?: {
    highLeaveUsers: { name: string; userId: number; approvedLeaves: number }[]
    frequentLateUsers: { name: string; userId: number; lateDays: number }[]
  }
  hrAlerts?: AlertRow[]
  highlights: {
    topPerformers: { name: string; branch: string; score: number }[]
    lateDefaulters: { name: string; status: string; workDate: string }[]
    violations: { type: string; count: number }[]
    weeklyLateFlags: { name: string; userId: number; lateDays: number }[]
  }
  insights: {
    leaveRequestsPending: number
    biometricRequests: number
    documentCompliancePct: number
  }
  staffByBranch: { name: string; staffCount: number }[]
  liveStatus?: { currentlyIn: number; missingOut: number }
  payrollPreview?: {
    grossCtcMonthlyINR: number
    attendanceDeductionsINR: number
    netFromPayrollINR?: number
    period?: string
    note: string
  }
}

type DrillPerson = {
  id: number
  full_name: string
  email?: string
  login_id?: string
  branch_name?: string
  status?: string
  punch_in_at?: string | null
  punch_out_at?: string | null
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    n
  )

const POLL_MS = 25000

export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [drill, setDrill] = useState<{ title: string; status: string } | null>(null)
  const [drillRows, setDrillRows] = useState<DrillPerson[]>([])
  const [drillLoading, setDrillLoading] = useState(false)

  const load = useCallback(() => {
    api<Overview>('/dashboard/overview')
      .then(setData)
      .catch((e: Error) => setErr(e.message))
  }, [])

  useEffect(() => {
    load()
    const t = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(t)
  }, [load])

  async function openDrill(title: string, status: string) {
    setDrill({ title, status })
    setDrillLoading(true)
    setDrillRows([])
    try {
      const d = await api<{ people: DrillPerson[] }>(
        '/dashboard/today-list?status=' + encodeURIComponent(status)
      )
      setDrillRows(d.people || [])
    } catch {
      setDrillRows([])
    } finally {
      setDrillLoading(false)
    }
  }

  if (err) {
    return (
      <div className="ph-card rounded-2xl p-6 text-red-700">
        Dashboard: {err}
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="relative h-14 w-14">
          <div className="ph-loader-orbit absolute inset-0 rounded-full border-2 border-dashed border-[#1f5e3b]/20 border-t-[#66bb6a]" />
          <div className="absolute inset-0 m-auto h-8 w-8 rounded-full bg-[#1f5e3b]/5" />
        </div>
      </div>
    )
  }

  const t = data.today
  const ha = data.hrAlerts || []
  const pol = data.alerts

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 pb-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#1f5e3b] sm:text-3xl">Dashboard</h1>
          <p className="text-sm text-[#1f5e3b]/65">
            Live overview · refreshes every {POLL_MS / 1000}s · {t.date}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#66bb6a]/35 bg-white px-3 py-1 text-xs font-semibold text-[#1f5e3b] shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#66bb6a] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2e7d32]" />
          </span>
          Real-time
        </span>
      </div>

      {(ha.length > 0 || (pol && (pol.frequentLateUsers?.length || pol.highLeaveUsers?.length))) && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Smart alerts</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {ha.length > 0 && (
              <div className="ph-card rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-amber-900/90">Security & attendance</div>
                <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs text-[#14261a]">
                  {ha.slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <span className="font-semibold text-amber-900">[{a.type}]</span> {a.message}
                      <span className="text-[#1f5e3b]/50"> · {a.created_at}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pol && (pol.frequentLateUsers?.length || pol.highLeaveUsers?.length) ? (
              <div className="ph-card rounded-2xl border border-red-100 bg-red-50/40 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-red-900/90">Policy warnings</div>
                {pol.frequentLateUsers && pol.frequentLateUsers.length > 0 && (
                  <p className="mt-2 text-xs text-[#14261a]">
                    Frequent late (14d): {pol.frequentLateUsers.map((x) => x.name).join(', ')}
                  </p>
                )}
                {pol.highLeaveUsers && pol.highLeaveUsers.length > 0 && (
                  <p className="mt-2 text-xs text-[#14261a]">
                    High approved leave count (YTD &gt; 4):{' '}
                    {pol.highLeaveUsers.map((x) => `${x.name} (${x.approvedLeaves})`).join(', ')}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">
          Today&apos;s Attendance
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Staff" value={t.totalStaff} variant="brand" />
          <StatCard
            label="Present"
            value={t.present}
            variant="present"
            onClick={() => openDrill('Present (incl. half)', 'present')}
          />
          <StatCard label="Late" value={t.late} variant="late" onClick={() => openDrill('Late', 'late')} />
          <StatCard
            label="Absent + Leave"
            value={t.absent + (t.onLeave || 0)}
            variant="absent"
            onClick={() => openDrill('Absent', 'absent')}
          />
        </div>
        {(t.halfDay != null || t.punchInCount != null) && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat
              title="Half-day"
              value={String(t.halfDay ?? 0)}
              sub="today"
              onClick={() => openDrill('Half-day', 'half')}
            />
            <MiniStat title="Punch in" value={String(t.punchInCount ?? 0)} sub="records" />
            <MiniStat title="Punch out" value={String(t.punchOutCount ?? 0)} sub="records" />
            <MiniStat
              title="Hours today (org)"
              value={t.totalHoursWorkedToday != null ? `${t.totalHoursWorkedToday}h` : '—'}
              sub="sum punch pairs"
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Overview</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniStat title="Workforce" value={String(data.stats.workforce)} sub="employees" />
          <MiniStat title="Monthly Budget" value={inr(data.stats.monthlyBudgetINR)} sub="planned" />
          <MiniStat title="Work Hours" value={`${data.stats.workHours}h`} sub="avg / month" />
          <MiniStat title="Offices" value={String(data.stats.offices)} sub="branches" />
        </div>
        {data.stats.totalHoursWorkedMonth != null && (
          <p className="mt-3 text-xs text-[#1f5e3b]/70">
            Month-to-date working hours (org):{' '}
            <strong>{data.stats.totalHoursWorkedMonth}h</strong>
          </p>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Employee Highlights</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Top Performers">
              <ul className="space-y-2.5">
                {data.highlights.topPerformers.slice(0, 5).map((p, i) => (
                  <li key={i} className="flex justify-between gap-2 text-sm">
                    <span className="font-medium text-[#14261a]">{p.name}</span>
                    <span className="shrink-0 text-[#2e7d32]">
                      {p.score}% · {p.branch}
                    </span>
                  </li>
                ))}
                {data.highlights.topPerformers.length === 0 && (
                  <li className="text-sm text-[#1f5e3b]/50">कोई डेटा नहीं</li>
                )}
              </ul>
            </Panel>
            <Panel title="Late / Defaulters">
              <ul className="space-y-2.5">
                {data.highlights.lateDefaulters.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2 text-sm">
                    <span className="text-[#14261a]">{r.name}</span>
                    <span className="text-amber-700">{r.status}</span>
                  </li>
                ))}
                {data.highlights.lateDefaulters.length === 0 && (
                  <li className="text-sm text-[#1f5e3b]/50">आज कोई late नहीं</li>
                )}
              </ul>
            </Panel>
          </div>
          <Panel title="Violation Reports">
            <ul className="space-y-2">
              {data.highlights.violations.map((v, i) => (
                <li key={i} className="flex justify-between text-sm">
                  <span>{v.type}</span>
                  <span className="font-semibold text-red-700">{v.count}</span>
                </li>
              ))}
            </ul>
            {data.highlights.weeklyLateFlags.length > 0 && (
              <p className="mt-4 border-t border-[#1f5e3b]/10 pt-3 text-xs text-amber-900/90">
                Weekly late 3+ days: {data.highlights.weeklyLateFlags.map((f) => f.name).join(', ')}
              </p>
            )}
          </Panel>
        </div>

        <div>
          <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Actionable Insights</h2>
          <div className="space-y-3">
            <InsightCard title="Leave Requests" value={data.insights.leaveRequestsPending} hint="pending approval" />
            <InsightCard title="Biometric Requests" value={data.insights.biometricRequests} hint="queue" />
            <div className="ph-card rounded-2xl p-5">
              <div className="text-xs font-semibold text-[#1f5e3b]/75">Document Compliance</div>
              <div className="mt-1 text-3xl font-bold text-[#1f5e3b]">{data.insights.documentCompliancePct}%</div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-emerald-100/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1f5e3b] via-[#66bb6a] to-[#a5d6a7] transition-all duration-500"
                  style={{ width: `${data.insights.documentCompliancePct}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Staff by Branch</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.staffByBranch.map((b) => (
            <div key={b.name} className="ph-card rounded-2xl p-6">
              <div className="text-lg font-bold text-[#1f5e3b]">{b.name}</div>
              <div className="mt-2 text-4xl font-semibold tabular-nums text-[#2e7d32]">{b.staffCount}</div>
              <div className="text-xs font-medium text-[#1f5e3b]/55">staff</div>
            </div>
          ))}
        </div>
      </section>

      {data.payrollPreview && (
        <section>
          <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Payroll (preview)</h2>
          <div className="ph-card rounded-2xl p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-[#1f5e3b]/65">Gross CTC (monthly)</div>
                <div className="mt-1 text-2xl font-bold text-[#14261a]">{inr(data.payrollPreview.grossCtcMonthlyINR)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#1f5e3b]/65">Attendance-based deductions (demo)</div>
                <div className="mt-1 text-2xl font-bold text-amber-800">
                  − {inr(data.payrollPreview.attendanceDeductionsINR)}
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[#1f5e3b]/60">{data.payrollPreview.note}</p>
          </div>
        </section>
      )}

      {drill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal
        >
          <div className="ph-card max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl">
            <div className="border-b border-[#1f5e3b]/10 px-5 py-3">
              <h3 className="font-semibold text-[#1f5e3b]">{drill.title}</h3>
              <p className="text-xs text-[#1f5e3b]/60">{data.today.date}</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
              {drillLoading ? (
                <p className="text-sm text-[#1f5e3b]/70">Loading…</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {drillRows.map((p) => (
                    <li key={p.id} className="border-b border-[#1f5e3b]/8 pb-2">
                      <div className="font-medium text-[#14261a]">{p.full_name}</div>
                      <div className="text-xs text-[#1f5e3b]/70">
                        {p.login_id || p.email || '—'} · {p.branch_name || '—'}
                      </div>
                      {p.punch_in_at && (
                        <div className="text-xs text-[#14261a]/80">In: {new Date(p.punch_in_at).toLocaleString()}</div>
                      )}
                    </li>
                  ))}
                  {drillRows.length === 0 && <li className="text-[#1f5e3b]/60">No rows.</li>}
                </ul>
              )}
            </div>
            <div className="border-t border-[#1f5e3b]/10 px-5 py-3">
              <button
                type="button"
                className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white"
                onClick={() => setDrill(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  variant,
  onClick,
}: {
  label: string
  value: number
  variant: 'brand' | 'present' | 'late' | 'absent'
  onClick?: () => void
}) {
  const grad =
    variant === 'brand'
      ? 'from-[#1f5e3b] via-[#2a6d47] to-[#1f5e3b]'
      : variant === 'present'
        ? 'from-[#2e7d32] to-[#66bb6a]'
        : variant === 'late'
          ? 'from-[#f9a825] to-[#fbc02d]'
          : 'from-[#c62828] to-[#e53935]'

  return (
    <div className="ph-stat-tall">
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className={`relative w-full overflow-hidden rounded-2xl bg-gradient-to-br px-5 py-6 text-left text-white shadow-lg transition ${grad} ${onClick ? 'cursor-pointer hover:brightness-[1.03]' : ''}`}
      >
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
        <div className="relative text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">{label}</div>
        <div className="relative mt-2 text-4xl font-bold tabular-nums tracking-tight sm:text-[2.75rem]">{value}</div>
        {onClick && <div className="relative mt-1 text-[10px] font-medium text-white/80">Tap for list</div>}
      </button>
    </div>
  )
}

function MiniStat({
  title,
  value,
  sub,
  onClick,
}: {
  title: string
  value: string
  sub: string
  onClick?: () => void
}) {
  const C = onClick ? 'button' : 'div'
  return (
    <C
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`ph-card rounded-2xl p-5 text-left ${onClick ? 'w-full cursor-pointer transition hover:bg-[#1f5e3b]/5' : ''}`}
    >
      <div className="text-xs font-semibold text-[#1f5e3b]/65">{title}</div>
      <div className="mt-2 text-xl font-bold text-[#14261a] sm:text-2xl">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-[#8d6e63]">{sub}</div>
    </C>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ph-card rounded-2xl p-5">
      <div className="mb-3 text-sm font-bold text-[#1f5e3b]">{title}</div>
      {children}
    </div>
  )
}

function InsightCard({ title, value, hint }: { title: string; value: number; hint: string }) {
  return (
    <div className="ph-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5">
      <div>
        <div className="text-xs font-semibold text-[#1f5e3b]/65">{title}</div>
        <div className="text-2xl font-bold text-[#1f5e3b]">{value}</div>
        <div className="text-[11px] text-[#8d6e63]">{hint}</div>
      </div>
      <span className="rounded-lg bg-[#e8f5e9] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#1f5e3b]">
        Review
      </span>
    </div>
  )
}
