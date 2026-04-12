import { useEffect, useState } from 'react'
import { api } from '../api'
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
}

type Branch = { id: number; name: string }

type UserRow = {
  id: number
  email: string
  full_name: string
  role: string
  branch_id: number | null
  active: number
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

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [roleSimple, setRoleSimple] = useState<'staff' | 'admin'>('staff')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [department, setDepartment] = useState('')

  const [edit, setEdit] = useState<UserRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editBranch, setEditBranch] = useState<number | ''>('')
  const [editActive, setEditActive] = useState(true)

  async function refresh() {
    setErr(null)
    setLoading(true)
    try {
      const d = await api<{ employees: Emp[] }>('/employees')
      setList(d.employees || [])
      if (canBranches) {
        const b = await api<{ branches: Branch[] }>('/branches')
        setBranches(b.branches || [])
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

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
          email: email.trim() || undefined,
          mobile: mobile || undefined,
          department: department || undefined,
        }),
      })
      setName('')
      setPassword('')
      setEmail('')
      setMobile('')
      setDepartment('')
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
      role: emp.rbacRole,
      branch_id: emp.branch_id,
      active: 1,
    })
    setEditName(emp.name)
    setEditBranch(emp.branch_id ?? '')
    setEditActive(true)
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
          branch_id: editBranch === '' ? null : Number(editBranch),
          active: editActive,
        }),
      })
      setEdit(null)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
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
                onChange={(e) => setRoleSimple(e.target.value as 'staff' | 'admin')}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin (HR)</option>
              </select>
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
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Department</span>
              <input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full rounded-xl border border-[#1f5e3b]/15 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button type="submit" className="rounded-xl bg-[#1f5e3b] px-5 py-2.5 text-sm font-semibold text-white">
            Create
          </button>
        </form>
      )}

      <div className="ph-card rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-[#1f5e3b]">Team</h2>
          <button type="button" onClick={refresh} className="text-sm font-medium text-[#1f5e3b] underline">
            Refresh
          </button>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        {loading ? (
          <p className="mt-4 text-sm">Loading…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#1f5e3b]/10 text-[#1f5e3b]/80">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Dept</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-[#1f5e3b]/5">
                    <td className="py-2 pr-3 font-medium">{r.name}</td>
                    <td className="py-2 pr-3 text-xs">{r.email}</td>
                    <td className="py-2 pr-3">{r.role}</td>
                    <td className="py-2 pr-3">{r.department || '—'}</td>
                    <td className="py-2">
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="text-sm font-semibold text-[#2e7d32] underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          </form>
        </div>
      )}
    </div>
  )
}
