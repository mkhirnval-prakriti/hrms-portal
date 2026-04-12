import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('prakritiherbs')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const data = await api<{ token?: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (data.token) setToken(data.token)
      nav('/', { replace: true })
    } catch (e) {
      setErr((e as Error).message || 'Login failed')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl shadow-black/20">
        <div className="mb-6 text-center">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            className="mx-auto h-20 w-20 object-contain"
          />
          <h1 className="mt-4 text-xl font-bold text-emerald-950">Prakriti Herbs HRMS</h1>
          <p className="text-xs uppercase tracking-widest text-emerald-700/70">Payroll + Attendance</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-emerald-800">Email / User ID</label>
            <input
              className="mt-1 w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 py-2.5 text-sm outline-none ring-emerald-600/20 focus:ring-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-emerald-800">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 py-2.5 text-sm outline-none ring-emerald-600/20 focus:ring-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20"
          >
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-emerald-700/60">
          Seed: prakritiherbs / Prakriti@123
        </p>
      </div>
    </div>
  )
}
