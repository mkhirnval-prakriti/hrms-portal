const JWT_KEY = 'ph_jwt'

/** Base URL for API (no trailing slash). Empty = same origin as the SPA. */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/\/$/, '')
  return ''
}

/** Full URL for `/api/...` requests (works with dev proxy and production same-origin). */
export function apiFetchUrl(apiPath: string): string {
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  return `${apiBaseUrl()}/api${p}`
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(JWT_KEY)
  } catch {
    return null
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(JWT_KEY, t)
    else localStorage.removeItem(JWT_KEY)
  } catch {
    /* ignore */
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (!isForm && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(apiFetchUrl(path), {
    credentials: 'include',
    headers,
    ...options,
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text }
  }
  if (!res.ok) {
    const err = new Error((data as { error?: string })?.error || res.statusText)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return data as T
}
