import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'

type Overview = {
  today: {
    date: string
    totalStaff: number
    present: number
    late: number
    absent: number
    onLeave?: number
  }
  stats: {
    workforce: number
    monthlyBudgetINR: number
    workHours: number
    offices: number
  }
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
    note: string
  }
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    n
  )

export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api<Overview>('/dashboard/overview')
      .then(setData)
      .catch((e: Error) => setErr(e.message))
  }, [])

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

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 pb-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1f5e3b] sm:text-3xl">Dashboard</h1>
          <p className="text-sm text-[#1f5e3b]/65">आज की उपस्थिति · {t.date}</p>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">
          Today&apos;s Attendance
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Staff" value={t.totalStaff} variant="brand" />
          <StatCard label="Present" value={t.present} variant="present" />
          <StatCard label="Late" value={t.late} variant="late" />
          <StatCard label="Absent" value={t.absent + (t.onLeave || 0)} variant="absent" />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[#1f5e3b]/55">Overview</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniStat title="Workforce" value={String(data.stats.workforce)} sub="employees" />
          <MiniStat title="Monthly Budget" value={inr(data.stats.monthlyBudgetINR)} sub="planned" />
          <MiniStat title="Work Hours" value={`${data.stats.workHours}h`} sub="avg / month" />
          <MiniStat title="Offices" value={String(data.stats.offices)} sub="branches" />
        </div>
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
                <div className="mt-1 text-2xl font-bold text-amber-800">− {inr(data.payrollPreview.attendanceDeductionsINR)}</div>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[#1f5e3b]/60">{data.payrollPreview.note}</p>
          </div>
        </section>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  variant,
}: {
  label: string
  value: number
  variant: 'brand' | 'present' | 'late' | 'absent'
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
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br px-5 py-6 text-white shadow-lg ${grad}`}
      >
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
        <div className="relative text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">{label}</div>
        <div className="relative mt-2 text-4xl font-bold tabular-nums tracking-tight sm:text-[2.75rem]">{value}</div>
      </div>
    </div>
  )
}

function MiniStat({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="ph-card rounded-2xl p-5">
      <div className="text-xs font-semibold text-[#1f5e3b]/65">{title}</div>
      <div className="mt-2 text-xl font-bold text-[#14261a] sm:text-2xl">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-[#8d6e63]">{sub}</div>
    </div>
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
