import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, getToken, setToken as persistToken } from '../api'

export type AuthUser = {
  id: number
  email: string
  login_id: string | null
  full_name: string
  role: string
  branch_id: number | null
  permissions?: Record<string, boolean>
}

type AuthContextValue = {
  user: AuthUser | null
  /** True only while validating an existing JWT (cold start with token in storage). */
  initializing: boolean
  completeLogin: (data: LoginSuccessPayload) => void
  refreshUser: () => Promise<void>
  clearSession: () => void
}

type LoginSuccessPayload = {
  token: string
  id: number
  email: string
  login_id?: string | null
  full_name: string
  role: string
  branch_id?: number | null
  permissions?: Record<string, boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function mapLoginToUser(data: LoginSuccessPayload): AuthUser {
  return {
    id: data.id,
    email: data.email,
    login_id: data.login_id ?? null,
    full_name: data.full_name,
    role: data.role,
    branch_id: data.branch_id ?? null,
    permissions: data.permissions,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [initializing, setInitializing] = useState(() => !!getToken())

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setInitializing(false)
      return
    }

    let cancelled = false
    api<AuthUser & { permissions?: Record<string, boolean> }>('/auth/me')
      .then((me) => {
        if (!cancelled) {
          setUser(me)
          setInitializing(false)
        }
      })
      .catch(() => {
        persistToken(null)
        if (!cancelled) {
          setUser(null)
          setInitializing(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const completeLogin = useCallback((data: LoginSuccessPayload) => {
    if (!data.token) return
    persistToken(data.token)
    setUser(mapLoginToUser(data))
    setInitializing(false)
  }, [])

  const refreshUser = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setInitializing(false)
      return
    }
    setInitializing(true)
    try {
      const me = await api<AuthUser & { permissions?: Record<string, boolean> }>('/auth/me')
      setUser(me)
    } catch {
      persistToken(null)
      setUser(null)
    } finally {
      setInitializing(false)
    }
  }, [])

  const clearSession = useCallback(() => {
    persistToken(null)
    setUser(null)
    setInitializing(false)
  }, [])

  const value = useMemo(
    () => ({
      user,
      initializing,
      completeLogin,
      refreshUser,
      clearSession,
    }),
    [user, initializing, completeLogin, refreshUser, clearSession]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Co-located hook + provider (standard React context pattern). */
// eslint-disable-next-line react-refresh/only-export-components -- useAuth must live next to AuthProvider
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
