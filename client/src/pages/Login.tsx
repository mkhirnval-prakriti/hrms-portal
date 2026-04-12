import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { LogoLoader } from '../components/LogoLoader'
import { useAuth } from '../context/AuthContext'

type LoginResponse = {
  token?: string
  id: number
  email: string
  login_id?: string | null
  full_name: string
  role: string
  branch_id?: number | null
}

export function Login() {
  const nav = useNavigate()
  const { user, initializing, completeLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const data = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (data.token) {
        completeLogin({ ...data, token: data.token })
        nav('/', { replace: true })
      }
    } catch (e) {
      setErr((e as Error).message || 'Sign in failed')
    }
  }

  const base = import.meta.env.BASE_URL

  if (initializing) {
    return <LogoLoader />
  }
  if (user) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#f5f7f6] via-white to-[#e8f0eb] px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 20%, rgba(102, 187, 106, 0.2) 0%, transparent 45%),
            radial-gradient(circle at 80% 80%, rgba(31, 94, 59, 0.08) 0%, transparent 40%)`,
        }}
      />
      <div className="relative w-full max-w-[420px]">
        <div className="rounded-3xl border border-white/70 bg-white/85 p-8 shadow-[0_24px_64px_rgba(31,94,59,0.12)] backdrop-blur-md md:p-10">
          <div className="mb-8 flex flex-col items-center">
            <img
              src={`${base}logo.png`}
              alt="Prakriti Herbs Ayurveda"
              className="h-[100px] w-auto max-w-[220px] object-contain"
              width={220}
              height={100}
            />
          </div>
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="ph-email" className="mb-1.5 block text-xs font-semibold tracking-wide text-[#1f5e3b]/90">
                Email or User ID
              </label>
              <input
                id="ph-email"
                className="w-full rounded-xl border border-[#1f5e3b]/12 bg-white/90 px-4 py-3 text-sm text-[#14261a] shadow-inner shadow-black/5 outline-none ring-[#1f5e3b]/0 transition focus:border-[#66bb6a]/50 focus:ring-4 focus:ring-[#1f5e3b]/10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder=""
              />
            </div>
            <div>
              <label htmlFor="ph-pass" className="mb-1.5 block text-xs font-semibold tracking-wide text-[#1f5e3b]/90">
                Password
              </label>
              <input
                id="ph-pass"
                type="password"
                className="w-full rounded-xl border border-[#1f5e3b]/12 bg-white/90 px-4 py-3 text-sm text-[#14261a] shadow-inner shadow-black/5 outline-none ring-[#1f5e3b]/0 transition focus:border-[#66bb6a]/50 focus:ring-4 focus:ring-[#1f5e3b]/10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder=""
              />
            </div>
            {err && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {err}
              </p>
            )}
            <button
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-[#1f5e3b] via-[#2a6d47] to-[#1f5e3b] py-3.5 text-sm font-semibold tracking-wide text-white shadow-[0_8px_24px_rgba(31,94,59,0.35)] transition hover:brightness-[1.03] active:scale-[0.99]"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
