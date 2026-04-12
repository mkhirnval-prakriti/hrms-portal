import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
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
  permissions?: Record<string, boolean>
}

export function Login() {
  const nav = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, initializing, completeLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const resetToken = searchParams.get('reset') || ''
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    try {
      const data = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, otp: otp.trim() || undefined }),
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
  if (user && !resetToken) {
    return <Navigate to="/" replace />
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    if (newPass.length < 6 || newPass !== newPass2) {
      setErr('Password must be at least 6 characters and match confirmation.')
      return
    }
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, new_password: newPass }),
      })
      setMsg('Password updated. You can sign in now.')
      setSearchParams({})
      setNewPass('')
      setNewPass2('')
    } catch (e) {
      setErr((e as Error).message || 'Reset failed')
    }
  }

  if (resetToken) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#f5f7f6] via-white to-[#e8f0eb] px-4 py-10">
        <div className="relative w-full max-w-[420px]">
          <div className="rounded-3xl border border-white/70 bg-white/85 p-8 shadow-[0_24px_64px_rgba(31,94,59,0.12)] backdrop-blur-md md:p-10">
            <p className="font-display mb-6 text-center text-lg font-semibold text-[#1f5e3b]">Set new password</p>
            <form onSubmit={submitReset} className="space-y-5">
              <div>
                <label htmlFor="ph-np1" className="mb-1.5 block text-xs font-semibold text-[#1f5e3b]/90">
                  New password
                </label>
                <input
                  id="ph-np1"
                  type="password"
                  className="w-full rounded-xl border border-[#1f5e3b]/12 bg-white/90 px-4 py-3 text-sm"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label htmlFor="ph-np2" className="mb-1.5 block text-xs font-semibold text-[#1f5e3b]/90">
                  Confirm password
                </label>
                <input
                  id="ph-np2"
                  type="password"
                  className="w-full rounded-xl border border-[#1f5e3b]/12 bg-white/90 px-4 py-3 text-sm"
                  value={newPass2}
                  onChange={(e) => setNewPass2(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {err && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {err}
                </p>
              )}
              {msg && <p className="text-sm text-[#2e7d32]">{msg}</p>}
              <button
                type="submit"
                className="w-full rounded-xl bg-gradient-to-r from-[#1f5e3b] via-[#2a6d47] to-[#1f5e3b] py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(31,94,59,0.35)]"
              >
                Update password
              </button>
              <button
                type="button"
                className="w-full text-center text-xs text-[#1f5e3b]/70 underline"
                onClick={() => setSearchParams({})}
              >
                Back to sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    )
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
          <div className="mb-6 flex flex-col items-center gap-2">
            <img
              src={`${base}logo.png`}
              alt="Prakriti Herbs Ayurveda"
              className="h-[100px] w-auto max-w-[220px] object-contain"
              width={220}
              height={100}
            />
            <p className="font-display text-center text-lg font-semibold tracking-tight text-[#1f5e3b]">
              Prakriti HRMS
            </p>
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
            <div>
              <label htmlFor="ph-otp" className="mb-1.5 block text-xs font-semibold tracking-wide text-[#1f5e3b]/90">
                Email OTP (if required by server)
              </label>
              <div className="flex gap-2">
                <input
                  id="ph-otp"
                  inputMode="numeric"
                  className="min-w-0 flex-1 rounded-xl border border-[#1f5e3b]/12 bg-white/90 px-4 py-3 text-sm text-[#14261a] shadow-inner"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="6-digit code"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  className="shrink-0 rounded-xl border border-[#1f5e3b]/20 bg-[#e8f5e9] px-3 text-xs font-semibold text-[#1f5e3b]"
                  onClick={async () => {
                    setErr('')
                    setMsg('')
                    try {
                      await api('/auth/otp/request', {
                        method: 'POST',
                        body: JSON.stringify({ email }),
                      })
                      setMsg('OTP sent to your email (if SMTP is configured).')
                    } catch (e) {
                      setErr((e as Error).message)
                    }
                  }}
                >
                  Send OTP
                </button>
              </div>
            </div>
            {msg && <p className="text-xs text-[#2e7d32]">{msg}</p>}
            <p className="text-center text-xs text-[#1f5e3b]/65">
              <button
                type="button"
                className="font-medium text-[#2e7d32] underline"
                onClick={async () => {
                  setErr('')
                  setMsg('')
                  try {
                    await api('/auth/forgot-password', {
                      method: 'POST',
                      body: JSON.stringify({ email }),
                    })
                    setMsg('If an account exists, a reset link was sent to your email.')
                  } catch (e) {
                    setErr((e as Error).message)
                  }
                }}
              >
                Forgot password?
              </button>
            </p>
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
