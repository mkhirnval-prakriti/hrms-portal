import { Link } from 'react-router-dom'

export function Placeholder({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="ph-card mx-auto max-w-lg rounded-xl p-8 text-center">
      <h1 className="text-xl font-bold text-emerald-950">{title}</h1>
      <p className="mt-2 text-sm text-emerald-800/70">
        {hint || 'This module uses the classic portal while we migrate screens to React.'}
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15"
      >
        Back to Dashboard
      </Link>
      <p className="mt-4 text-xs text-emerald-700/60">
        Full flows: open{' '}
        <a className="font-medium underline" href="/portal/">
          Legacy portal
        </a>{' '}
        (/portal)
      </p>
    </div>
  )
}
