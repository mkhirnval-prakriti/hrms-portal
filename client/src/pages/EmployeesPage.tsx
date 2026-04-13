import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, apiFetchUrl, getToken } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'

type Emp = {
  id: number
  name: string
  role: string
  rbacRole: string
  department: string | null
  mobile: string | null
  email: string
  branch_id: number | null
  login_id?: string | null
  dob?: string | null
  joining_date?: string | null
  address?: string | null
  account_number?: string | null
  ifsc?: string | null
  bank_name?: string | null
  document_count?: number
  shift_start?: string
  shift_end?: string
  grace_minutes?: number
  profile_photo?: string | null
  active?: number
  allow_gps?: number
  allow_face?: number
  allow_manual?: number
  allow_biometric?: number
}

type Branch = { id: number; name: string }
type Department = { id: number; name: string; active?: number }

type UserRow = {
  id: number
  email: string
  full_name: string
  login_id?: string | null
  mobile?: string | null
  department?: string | null
  dob?: string | null
  joining_date?: string | null
  address?: string | null
  account_number?: string | null
  ifsc?: string | null
  bank_name?: string | null
  role: string
  branch_id: number | null
  active: number
}

type DocRow = {
  id: number
  user_id: number
  doc_type: string
  file_name: string
  file_path: string
  verified: number
}

export function EmployeesPage() {
  const { user } = useAuth()
  const [list, setList] = useState<Emp[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const canCreate = canPerm(user, 'users:create')
  const canUpdate = canPerm(user, 'users:update')
  const canBranches = canPerm(user, 'branches:read')
  const canRoles = canPerm(user, 'roles:read')
  const canManageDepartments = user?.role === 'SUPER_ADMIN'

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [roleSimple, setRoleSimple] = useState('staff')
  const [employeeId, setEmployeeId] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [department, setDepartment] = useState('')
  const [staffSubType, setStaffSubType] = useState('Sales Executive')
  const [departments, setDepartments] = useState<Department[]>([])
  const [newDepartment, setNewDepartment] = useState('')
  const [dob, setDob] = useState('')
  const [joiningDate, setJoiningDate] = useState('')
  const [address, setAddress] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [bankName, setBankName] = useState('')
  const [createBranch, setCreateBranch] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'custom'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [edit, setEdit] = useState<UserRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmployeeId, setEditEmployeeId] = useState('')
  const [editMobile, setEditMobile] = useState('')
  const [editDepartment, setEditDepartment] = useState('')
  const [editRole, setEditRole] = useState('staff')
  const [editDob, setEditDob] = useState('')
  const [editJoiningDate, setEditJoiningDate] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editAccountNumber, setEditAccountNumber] = useState('')
  const [editIfsc, setEditIfsc] = useState('')
  const [editBankName, setEditBankName] = useState('')
  const [editBranch, setEditBranch] = useState<number | ''>('')
  const [editActive, setEditActive] = useState(true)
  const [editDocs, setEditDocs] = useState<DocRow[]>([])
  const [editDocType, setEditDocType] = useState('aadhaar')
  const [editDocFile, setEditDocFile] = useState<File | null>(null)
  const [editAllowGps, setEditAllowGps] = useState(true)
  const [editAllowFace, setEditAllowFace] = useState(false)
  const [editAllowManual, setEditAllowManual] = useState(true)
  const [editAllowFingerprint, setEditAllowFingerprint] = useState(false)
  const [editPassword, setEditPassword] = useState('')

  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() => {
    try {
      const v = localStorage.getItem('hrms-employees-view')
      return v === 'cards' ? 'cards' : 'table'
    } catch {
      return 'table'
    }
  })

  const branchById = useMemo(() => {
    const m = new Map<number, string>()
    branches.forEach((b) => m.set(b.id, b.name))
    return m
  }, [branches])
  const roleOptions = useMemo(
    () => [
      { value: 'super_admin', label: 'Super Admin' },
      { value: 'admin', label: 'Admin' },
      { value: 'branch_manager', label: 'Branch Manager' },
      { value: 'attendance_manager', label: 'Attendance Manager' },
      { value: 'staff', label: 'Staff' },
    ],
    []
  )
  const departmentNames = useMemo(() => departments.map((d) => d.name), [departments])

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((r) => {
      const key = `${r.name} ${r.login_id || ''} ${r.mobile || ''}`.toLowerCase()
      return key.includes(q)
    })
  }, [list, search])

  const refresh = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const employeesRes = await api<{ employees: Emp[] }>('/employees')
      setList(employeesRes.employees || [])
      if (canBranches) {
        const b = await api<{ branches: Branch[] }>('/branches')
        setBranches(b.branches || [])
      }
      const depRes = await api<{ departments: Department[] }>('/departments')
      setDepartments(depRes.departments || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [canBranches])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createEmp(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await api('/employees', {
        method: 'POST',
        body: JSON.stringify({
          name,
          password,
          role: roleSimple,
          staff_sub_type: roleSimple === 'staff' ? staffSubType : undefined,
          login_id: employeeId.trim() || undefined,
          email: email.trim() || undefined,
          mobile: mobile || undefined,
          department: department || (roleSimple === 'staff' ? staffSubType : undefined),
          branch_id: createBranch === '' ? undefined : Number(createBranch),
          dob: dob || undefined,
          joining_date: joiningDate || undefined,
          address: address || undefined,
          account_number: accountNumber || undefined,
          ifsc: ifsc || undefined,
          bank_name: bankName || undefined,
        }),
      })
      setName('')
      setPassword('')
      setEmployeeId('')
      setEmail('')
      setMobile('')
      setDepartment('')
      setStaffSubType('Sales Executive')
      setDob('')
      setJoiningDate('')
      setAddress('')
      setAccountNumber('')
      setIfsc('')
      setBankName('')
      setCreateBranch('')
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  function openEdit(emp: Emp) {
    if (!canUpdate) return
    setEdit({
      id: emp.id,
      email: emp.email,
      full_name: emp.name,
      login_id: emp.login_id ?? null,
      mobile: emp.mobile ?? null,
      department: emp.department ?? null,
      dob: emp.dob ?? null,
      joining_date: emp.joining_date ?? null,
      address: emp.address ?? null,
      account_number: emp.account_number ?? null,
      ifsc: emp.ifsc ?? null,
      bank_name: emp.bank_name ?? null,
      role: emp.rbacRole,
      branch_id: emp.branch_id,
      active: emp.active !== 0 ? 1 : 0,
    })
    setEditName(emp.name)
    setEditEmployeeId(emp.login_id || '')
    setEditMobile(emp.mobile || '')
    setEditDepartment(emp.department || '')
    setEditRole(emp.rbacRole || 'USER')
    setEditDob(emp.dob || '')
    setEditJoiningDate(emp.joining_date || '')
    setEditAddress(emp.address || '')
    setEditAccountNumber(emp.account_number || '')
    setEditIfsc(emp.ifsc || '')
    setEditBankName(emp.bank_name || '')
    setEditBranch(emp.branch_id ?? '')
    setEditActive(emp.active !== 0)
    setEditAllowGps(Number(emp.allow_gps ?? 1) !== 0)
    setEditAllowFace(Number(emp.allow_face ?? 0) !== 0)
    setEditAllowManual(Number(emp.allow_manual ?? 1) !== 0)
    setEditAllowFingerprint(Number(emp.allow_biometric ?? 0) !== 0)
    setEditPassword('')
    void loadEditDocs(emp.id)
  }

  async function loadEditDocs(userId: number) {
    try {
      const d = await api<{ documents: DocRow[] }>('/documents')
      setEditDocs((d.documents || []).filter((x) => Number(x.user_id) === Number(userId)))
    } catch {
      setEditDocs([])
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!edit) return
    setErr(null)
    try {
      await api(`/users/${edit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: editName,
          login_id: editEmployeeId || undefined,
          mobile: editMobile || undefined,
          department: editDepartment || undefined,
          role: editRole || undefined,
          dob: editDob || undefined,
          joining_date: editJoiningDate || undefined,
          address: editAddress || undefined,
          account_number: editAccountNumber || undefined,
          ifsc: editIfsc || undefined,
          bank_name: editBankName || undefined,
          branch_id: editBranch === '' ? null : Number(editBranch),
          active: editActive,
          allow_gps: editAllowGps,
          allow_face: editAllowFace,
          allow_manual: editAllowManual,
          allow_biometric: editAllowFingerprint,
          password: user?.role === 'SUPER_ADMIN' && editPassword.trim() ? editPassword.trim() : undefined,
        }),
      })
      setEdit(null)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function deleteEmp(id: number) {
    setErr(null)
    try {
      await api(`/staff/${id}`, { method: 'DELETE' })
      setList((prev) => prev.filter((x) => x.id !== id))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  function setView(next: 'table' | 'cards') {
    setViewMode(next)
    try {
      localStorage.setItem('hrms-employees-view', next)
    } catch {
      /* ignore */
    }
  }

  function branchLabel(emp: Emp) {
    if (emp.branch_id == null) return '—'
    return branchById.get(emp.branch_id) ?? `ID ${emp.branch_id}`
  }
  function roleLabel(emp: Emp) {
    const key = String(emp.rbacRole || emp.role || '').toUpperCase()
    const map: Record<string, string> = {
      SUPER_ADMIN: 'Super Admin',
      ADMIN: 'Admin',
      LOCATION_MANAGER: 'Branch Manager',
      ATTENDANCE_MANAGER: 'Attendance Manager',
      USER: 'Staff',
    }
    return map[key] || emp.role || key
  }

  async function uploadPhoto(id: number, file: File) {
    setErr(null)
    try {
      const body = new FormData()
      body.append('photo', file)
      await api(`/staff/${id}/photo`, { method: 'POST', body })
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function uploadEditDoc() {
    if (!edit || !editDocFile) return
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', editDocFile)
      fd.append('doc_type', editDocType)
      fd.append('user_id', String(edit.id))
      await api('/documents', { method: 'POST', body: fd })
      setEditDocFile(null)
      await loadEditDocs(edit.id)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function createDepartment() {
    const name = newDepartment.trim()
    if (!name) return
    setErr(null)
    try {
      await api('/departments', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setNewDepartment('')
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  function completionPercent(r: Emp) {
    let p = 0
    if (r.name?.trim()) p += 10
    if (r.mobile?.trim()) p += 10
    if (r.dob?.trim()) p += 10
    if (r.address?.trim()) p += 10
    if (r.profile_photo?.trim()) p += 10
    const hasDocs = Number(r.document_count || 0) > 0
    if (hasDocs) p += 20
    const bankBits = [r.account_number, r.ifsc, r.bank_name].filter((x) => String(x || '').trim()).length
    p += Math.round((bankBits / 3) * 30)
    return Math.min(100, p)
  }

  function missingFields(r: Emp) {
    const miss: string[] = []
    if (!r.mobile) miss.push('mobile')
    if (!r.dob) miss.push('dob')
    if (!r.address) miss.push('address')
    if (!r.profile_photo) miss.push('photo')
    if (!r.account_number || !r.ifsc || !r.bank_name) miss.push('bank')
    return miss
  }

  async function exportEmployees(format: 'csv' | 'xlsx' | 'pdf') {
    const params = new URLSearchParams()
    params.set('date_filter', dateFilter)
    if (dateFilter === 'custom') {
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
    }
    const token = getToken()
    const url = `${apiFetchUrl('/employees/export.' + format)}?${params.toString()}`
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(`Export failed (${res.status})`)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `employees.${format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1f5e3b]">Employees</h1>
        <p className="text-sm text-[#1f5e3b]/70">Directory synced with backend users.</p>
      </div>

      {canCreate && (
        <form onSubmit={createEmp} className="ph-card space-y-4 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Add employee</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Full name *</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Password *</span>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Role</span>
              <select
                value={roleSimple}
                onChange={(e) => setRoleSimple(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              >
                {roleOptions
                  .filter((opt) => (canRoles ? true : opt.value === 'staff' || opt.value === 'admin'))
                  .map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Employee ID (editable)</span>
              <input
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Email (optional)</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Mobile</span>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            {roleSimple === 'staff' && (
              <label className="text-sm">
                <span className="mb-1 block font-medium">Staff sub-type</span>
                <select value={staffSubType} onChange={(e) => setStaffSubType(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm">
                  {departmentNames.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block font-medium">Department</span>
              <input list="department-options" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              <datalist id="department-options">
                {departmentNames.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </label>
            {canBranches && branches.length > 0 && (
              <label className="text-sm">
                <span className="mb-1 block font-medium">Branch</span>
                <select value={createBranch} onChange={(e) => setCreateBranch(e.target.value === '' ? '' : Number(e.target.value))} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm">
                  <option value="">Auto (my branch)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block font-medium">Date of birth</span>
              <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Joining date</span>
              <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Account Number</span>
              <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">IFSC</span>
              <input value={ifsc} onChange={(e) => setIfsc(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Bank Name</span>
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
          </div>
          <button type="submit" className="rounded-xl bg-[#1f5e3b] px-5 py-2.5 text-sm font-semibold text-white">
            Create
          </button>
        </form>
      )}
      {canManageDepartments && (
        <div className="ph-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Department Control</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} placeholder="Add new department" className="rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            <button type="button" onClick={() => void createDepartment()} className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white">
              Add
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {departmentNames.map((d) => (
              <span key={d} className="rounded-full bg-[#e8f5e9] px-2.5 py-1 text-xs font-semibold text-[#1f5e3b]">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="ph-card rounded-2xl p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Team</h2>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / ID / mobile"
              className="rounded-xl border border-[#1f5e3b]/15 px-3 py-1.5 text-xs"
            />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as 'all' | 'today' | 'yesterday' | 'custom')}
              className="rounded-xl border border-[#1f5e3b]/15 px-2 py-1.5 text-xs"
            >
              <option value="all">All</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="custom">Custom</option>
            </select>
            {dateFilter === 'custom' && (
              <>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-2 py-1.5 text-xs" />
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-2 py-1.5 text-xs" />
              </>
            )}
            <button type="button" onClick={() => void exportEmployees('xlsx')} className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]">Excel</button>
            <button type="button" onClick={() => void exportEmployees('pdf')} className="rounded-lg border border-[#1f5e3b]/20 px-2 py-1 text-xs font-semibold text-[#1f5e3b]">PDF</button>
            <div className="inline-flex rounded-xl border border-[#1f5e3b]/15 bg-[#f5faf6] p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setView('table')}
                className={`rounded-lg px-3 py-1.5 transition ${
                  viewMode === 'table' ? 'bg-white text-[#1f5e3b] shadow-sm' : 'text-[#1f5e3b]/70'
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setView('cards')}
                className={`rounded-lg px-3 py-1.5 transition ${
                  viewMode === 'cards' ? 'bg-white text-[#1f5e3b] shadow-sm' : 'text-[#1f5e3b]/70'
                }`}
              >
                Cards
              </button>
            </div>
            <button type="button" onClick={refresh} className="text-sm font-medium text-[#1f5e3b] underline">
              Refresh
            </button>
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="mt-4 text-sm">Loading…</p>
        ) : viewMode === 'table' ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#1f5e3b]/10 text-[#1f5e3b]/80">
                  <th className="py-2 pr-3">Photo</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 pr-3">Shift</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Dept</th>
                  <th className="py-2 pr-3">Completion</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((r) => (
                  <tr key={r.id} id={`emp-row-${r.id}`} className="border-b border-[#1f5e3b]/5">
                    <td className="py-2 pr-3">
                      {r.profile_photo ? (
                        <img src={r.profile_photo} alt={r.name} className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f5e9] text-xs font-bold text-[#1f5e3b]">
                          {r.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-medium">{r.name}</td>
                    <td className="py-2 pr-3 text-xs tabular-nums text-[#37474f]">{r.login_id || `#${r.id}`}</td>
                    <td className="py-2 pr-3 text-xs">{r.email}</td>
                    <td className="py-2 pr-3">{roleLabel(r)}</td>
                    <td className="py-2 pr-3 text-xs">{branchLabel(r)}</td>
                    <td className="py-2 pr-3 text-xs tabular-nums text-[#37474f]">
                      {r.shift_start && r.shift_end ? `${r.shift_start} – ${r.shift_end}` : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {r.active === 0 ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">INACTIVE</span>
                      ) : (
                        <span className="rounded-full bg-[#e8f5e9] px-2 py-0.5 text-xs font-semibold text-[#1f5e3b]">ACTIVE</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{r.department || '—'}</td>
                    <td className="py-2 pr-3 text-xs">{completionPercent(r)}%</td>
                    <td className="py-2">
                      {canUpdate && <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="text-sm font-semibold text-[#2e7d32] underline"
                        >
                          Edit
                        </button>
                        <label className="cursor-pointer text-sm font-semibold text-[#1f5e3b] underline">
                          Photo
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) void uploadPhoto(r.id, f)
                              e.currentTarget.value = ''
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => deleteEmp(r.id)}
                          className="text-sm font-semibold text-red-700 underline"
                        >
                          Delete
                        </button>
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredList.map((r) => (
              <div
                key={r.id}
                id={`emp-card-${r.id}`}
                className="flex flex-col rounded-2xl border border-[#1f5e3b]/10 bg-white/90 p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  {r.profile_photo ? (
                    <img src={r.profile_photo} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-[#1f5e3b]/10" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#e8f5e9] text-lg font-bold text-[#1f5e3b] ring-1 ring-[#1f5e3b]/10">
                      {r.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-[#14261a]">{r.name}</h3>
                      {r.active === 0 ? (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                          Inactive
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1f5e3b]">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs font-medium tabular-nums text-[#546e7a]">{r.login_id || `ID #${r.id}`}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-xs text-[#37474f]">
                  <div className="flex justify-between gap-2 border-t border-[#1f5e3b]/8 pt-3">
                    <dt className="text-[#1f5e3b]/65">Role</dt>
                    <dd className="font-medium text-[#14261a]">{roleLabel(r)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#1f5e3b]/65">Branch</dt>
                    <dd className="text-right font-medium text-[#14261a]">{branchLabel(r)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#1f5e3b]/65">Shift</dt>
                    <dd className="text-right font-medium tabular-nums text-[#14261a]">
                      {r.shift_start && r.shift_end ? `${r.shift_start} – ${r.shift_end}` : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#1f5e3b]/65">Dept</dt>
                    <dd className="text-right font-medium text-[#14261a]">{r.department || '—'}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-[#1f5e3b]/70">Profile completion</span>
                    <span className="font-semibold text-[#1f5e3b]">{completionPercent(r)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#e8f5e9]">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#1f5e3b] to-[#66bb6a]" style={{ width: `${completionPercent(r)}%` }} />
                  </div>
                  {missingFields(r).length > 0 && (
                    <p className="mt-1 text-[10px] text-amber-700">Missing: {missingFields(r).join(', ')}</p>
                  )}
                </div>
                {canUpdate && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1f5e3b]/8 pt-3">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded-lg bg-[#1f5e3b] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Edit
                    </button>
                    <label className="cursor-pointer rounded-lg border border-[#1f5e3b]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[#1f5e3b]">
                      Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void uploadPhoto(r.id, f)
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteEmp(r.id)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!loading && filteredList.length === 0 && (
          <p className="mt-4 text-sm text-[#1f5e3b]/65">No employees found.</p>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
          <form
            onSubmit={saveEdit}
            className="ph-card max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-6 shadow-2xl"
          >
            <h3 className="text-lg font-semibold text-[#1f5e3b]">Edit user</h3>
            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium">Full name</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Employee ID</span>
              <input value={editEmployeeId} onChange={(e) => setEditEmployeeId(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Role</span>
              <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm">
                <option value="USER">Staff</option>
                <option value="ATTENDANCE_MANAGER">Attendance Manager</option>
                <option value="LOCATION_MANAGER">Branch Manager</option>
                <option value="ADMIN">Admin</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Mobile</span>
              <input value={editMobile} onChange={(e) => setEditMobile(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Department</span>
              <input list="department-options" value={editDepartment} onChange={(e) => setEditDepartment(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">DOB</span>
                <input type="date" value={editDob} onChange={(e) => setEditDob(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Joining Date</span>
                <input type="date" value={editJoiningDate} onChange={(e) => setEditJoiningDate(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Address</span>
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Account</span>
                <input value={editAccountNumber} onChange={(e) => setEditAccountNumber(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">IFSC</span>
                <input value={editIfsc} onChange={(e) => setEditIfsc(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Bank</span>
                <input value={editBankName} onChange={(e) => setEditBankName(e.target.value)} className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              </label>
            </div>
            {canBranches && branches.length > 0 && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">Branch</span>
                <select
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
              Active
            </label>
            <div className="mt-3 rounded-xl border border-[#1f5e3b]/10 bg-[#f7fbf8] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#1f5e3b]/70">Attendance controls</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editAllowGps} onChange={(e) => setEditAllowGps(e.target.checked)} />
                  GPS
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editAllowFace} onChange={(e) => setEditAllowFace(e.target.checked)} />
                  Face
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editAllowFingerprint} onChange={(e) => setEditAllowFingerprint(e.target.checked)} />
                  Fingerprint
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editAllowManual} onChange={(e) => setEditAllowManual(e.target.checked)} />
                  Manual entry
                </label>
              </div>
            </div>
            {user?.role === 'SUPER_ADMIN' && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">Reset password (optional)</span>
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Leave blank to keep existing password" className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm" />
              </label>
            )}
            <div className="mt-6 flex gap-3">
              <button type="submit" className="rounded-xl bg-[#1f5e3b] px-4 py-2 text-sm font-semibold text-white">
                Save
              </button>
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="rounded-xl border border-[#1f5e3b]/20 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
            <div className="mt-6 border-t border-[#1f5e3b]/10 pt-4">
              <h4 className="text-sm font-semibold text-[#1f5e3b]">Employee documents</h4>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <select value={editDocType} onChange={(e) => setEditDocType(e.target.value)} className="rounded-xl border border-[#1f5e3b]/15 px-2 py-1.5 text-xs">
                  <option value="aadhaar">Aadhaar</option>
                  <option value="id">ID</option>
                  <option value="bank">Bank</option>
                  <option value="other">Other</option>
                </select>
                <input type="file" onChange={(e) => setEditDocFile(e.target.files?.[0] || null)} className="text-xs" />
                <button type="button" onClick={() => void uploadEditDoc()} className="rounded-lg bg-[#1f5e3b] px-3 py-1.5 text-xs font-semibold text-white">Upload</button>
              </div>
              <div className="mt-3 max-h-40 space-y-2 overflow-auto">
                {editDocs.map((d) => (
                  <a key={d.id} href={d.file_path} target="_blank" rel="noreferrer" className="block rounded-lg border border-[#1f5e3b]/10 bg-white px-3 py-2 text-xs">
                    {d.doc_type} - {d.file_name}
                  </a>
                ))}
                {editDocs.length === 0 && <p className="text-xs text-[#1f5e3b]/65">No documents uploaded.</p>}
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
