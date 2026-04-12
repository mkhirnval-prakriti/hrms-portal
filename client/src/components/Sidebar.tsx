import { NavLink } from 'react-router-dom'

const items: { to: string; label: string }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/employees', label: 'Employees' },
  { to: '/documents', label: 'Doc Verification' },
  { to: '/leaves', label: 'Leaves' },
  { to: '/payroll', label: 'Payroll' },
  { to: '/staff-mgmt', label: 'Staff Mgmt' },
  { to: '/kiosk', label: 'Kiosk Mode' },
  { to: '/trash', label: 'Trash' },
  { to: '/office', label: 'Office Location' },
  { to: '/company', label: 'Company' },
  { to: '/notices', label: 'Notice Board' },
  { to: '/guide', label: 'System Guide' },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'block rounded-lg px-3 py-2.5 text-sm font-medium transition',
    isActive
      ? 'bg-white text-emerald-900 shadow-md shadow-emerald-900/10'
      : 'text-emerald-50/90 hover:bg-white/10',
  ].join(' ')

export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col ph-gradient text-white min-h-screen">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-11 w-11 rounded-lg bg-white/10 object-contain p-1" />
        <div>
          <div className="text-sm font-bold leading-tight">Prakriti Herbs</div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-emerald-100/80">
            HRMS Portal
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.to === '/'} className={linkClass}>
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3 text-[10px] text-emerald-100/70">
        © Prakriti Herbs Ayurveda
      </div>
    </aside>
  )
}
