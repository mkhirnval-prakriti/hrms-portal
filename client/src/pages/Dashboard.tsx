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
      <div className="ph-card rounded-xl p-6 text-red-700">
        Dashboard: {err}
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-emerald-800/70">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }

  const t = data.today

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-emerald-950">Dashboard</h1>
        <p className="text-sm text-emerald-800/70">आज की उपस्थिति · {t.date}</p>
      </div>

      {/* Today's attendance */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-800/80">
          Today&apos;s Attendance
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Staff" value={t.totalStaff} accent="from-emerald-700 to-emerald-600" />
          <StatCard label="Present" value={t.present} accent="from-green-600 to-emerald-500" />
          <StatCard label="Late" value={t.late} accent="from-amber-500 to-yellow-500" />
          <StatCard label="Absent" value={t.absent + (t.onLeave || 0)} accent="from-red-500 to-rose-500" />
        </div>
      </section>

      {/* Stats row */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-800/80">Overview</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat title="Workforce" value={String(data.stats.workforce)} sub="employees" />
          <MiniStat title="Monthly Budget" value={inr(data.stats.monthlyBudgetINR)} sub="planned" />
          <MiniStat title="Work Hours" value={`${data.stats.workHours}h`} sub="avg / month" />
          <MiniStat title="Offices" value={String(data.stats.offices)} sub="branches" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Highlights */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800/80">
            Employee Highlights
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Top Performers">
              <ul className="space-y-2">
                {data.highlights.topPerformers.slice(0, 5).map((p, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="font-medium text-emerald-950">{p.name}</span>
                    <span className="text-emerald-600">{p.score}% · {p.branch}</span>
                  </li>
                ))}
                {data.highlights.topPerformers.length === 0 && (
                  <li className="text-sm text-emerald-700/60">कोई डेटा नहीं</li>
                )}
              </ul>
            </Panel>
            <Panel title="Late / Defaulters">
              <ul className="space-y-2">
                {data.highlights.lateDefaulters.map((r, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span>{r.name}</span>
                    <span className="text-amber-700">{r.status}</span>
                  </li>
                ))}
                {data.highlights.lateDefaulters.length === 0 && (
                  <li className="text-sm text-emerald-700/60">आज कोई late नहीं</li>
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
              <p className="mt-3 border-t border-emerald-100 pt-3 text-xs text-amber-800">
                Weekly late 3+ days:{' '}
                {data.highlights.weeklyLateFlags.map((f) => f.name).join(', ')}
              </p>
            )}
          </Panel>
        </div>

        {/* Insights */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-800/80">
            Actionable Insights
          </h2>
          <div className="space-y-3">
            <InsightCard
              title="Leave Requests"
              value={data.insights.leaveRequestsPending}
              hint="pending approval"
            />
            <InsightCard title="Biometric Requests" value={data.insights.biometricRequests} hint="queue" />
            <div className="ph-card rounded-xl p-4">
              <div className="text-xs font-medium text-emerald-700/80">Document Compliance</div>
              <div className="mt-1 text-2xl font-bold text-emerald-800">
                {data.insights.documentCompliancePct}%
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-lime-400"
                  style={{ width: `${data.insights.documentCompliancePct}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Staff by branch */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-800/80">
          Staff by Branch
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {data.staffByBranch.map((b) => (
            <div key={b.name} className="ph-card rounded-xl p-5">
              <div className="text-lg font-bold text-emerald-900">{b.name}</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-700">{b.staffCount}</div>
              <div className="text-xs text-emerald-600/80">staff</div>
            </div>
          ))}
        </div>
      </section>

      {data.payrollPreview && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-800/80">
            Payroll (preview)
          </h2>
          <div className="ph-card rounded-xl p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-emerald-700/80">Gross CTC (monthly)</div>
                <div className="text-xl font-bold">{inr(data.payrollPreview.grossCtcMonthlyINR)}</div>
              </div>
              <div>
                <div className="text-xs text-emerald-700/80">Attendance-based deductions (demo)</div>
                <div className="text-xl font-bold text-amber-800">
                  − {inr(data.payrollPreview.attendanceDeductionsINR)}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-emerald-700/70">{data.payrollPreview.note}</p>
          </div>
        </section>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: string
}) {
  return (
    <div className={`ph-card overflow-hidden rounded-xl`}>
      <div className={`bg-gradient-to-br ${accent} px-4 py-3 text-white`}>
        <div className="text-xs font-medium uppercase tracking-wide opacity-90">{label}</div>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function MiniStat({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="ph-card rounded-xl p-4">
      <div className="text-xs font-medium text-emerald-700/80">{title}</div>
      <div className="mt-1 text-xl font-bold text-emerald-950">{value}</div>
      <div className="text-[11px] text-emerald-600/70">{sub}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ph-card rounded-xl p-4">
      <div className="mb-2 text-sm font-semibold text-emerald-900">{title}</div>
      {children}
    </div>
  )
}

function InsightCard({ title, value, hint }: { title: string; value: number; hint: string }) {
  return (
    <div className="ph-card flex items-center justify-between rounded-xl p-4">
      <div>
        <div className="text-xs font-medium text-emerald-700/80">{title}</div>
        <div className="text-lg font-bold text-emerald-900">{value}</div>
        <div className="text-[11px] text-emerald-600/70">{hint}</div>
      </div>
      <div className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">Action</div>
    </div>
  )
}
