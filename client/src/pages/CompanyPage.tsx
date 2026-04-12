import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { canPerm } from '../lib/permissions'
import { PageSkeleton } from '../components/PageSkeleton'

export function CompanyPage() {
  const { user } = useAuth()
  const can = canPerm(user, 'settings:read')

  const q = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => api<Record<string, unknown>>('/settings'),
    enabled: can,
    retry: 2,
    staleTime: 60_000,
  })

  if (!can) {
    return (
      <div className="ph-card mx-auto max-w-lg rounded-2xl p-8 text-center text-sm text-[#1f5e3b]">
        Company settings are visible to HR / Admin roles.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6 pb-8">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">Company</h1>
      {q.error && (
        <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800">
          <p className="font-medium">Failed to load config</p>
          <p className="mt-1">{(q.error as Error).message}</p>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="mt-3 rounded-lg bg-[#1f5e3b] px-4 py-2 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      )}
      {q.isLoading && <PageSkeleton rows={4} />}
      {q.data && !q.isLoading && (
        <div className="ph-card rounded-2xl p-6 text-sm">
          <pre className="overflow-x-auto whitespace-pre-wrap text-[#14261a]">{JSON.stringify(q.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
