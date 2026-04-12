import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Layout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-[#f5f7f6]">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col md:pl-0">
        <TopBar onMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 p-4 transition-opacity duration-200 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
