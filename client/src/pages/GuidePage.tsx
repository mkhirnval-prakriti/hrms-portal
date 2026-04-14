export function GuidePage() {
  return (
    <div className="mx-auto max-w-[800px] space-y-5 pb-8 text-sm leading-relaxed text-[#14261a]">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">System guide (Hindi)</h1>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">1) Attendance ka istemal (Step-by-step)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Dashboard se Attendance ya Kiosk kholiye.</li>
          <li>Field staff: GPS check-in/check-out use karein.</li>
          <li>Office staff: Office location button se punch karein.</li>
          <li>Agar PIN enabled hai to Kiosk me Employee ID + PIN se punch karein.</li>
          <li>Galat entry ho to manager Manual Override se record sahi kare.</li>
        </ol>
      </section>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">2) Leave module</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Staff future date ke liye leave apply kare (reason mandatory).</li>
          <li>Manager/Admin request open karke thread me reply kar sakte hain.</li>
          <li>Pending stage me staff bhi chat thread me jawab de sakta hai.</li>
          <li>Approve hone par leave attendance me reflect hoti hai.</li>
        </ol>
      </section>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">3) Staff, documents, aur security</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Employee edit me attendance modes (GPS/Face/Thumb/Manual) control karein.</li>
          <li>Super Admin reset password aur secure temporary reveal kar sakta hai.</li>
          <li>Documents upload ke baad Admin approve/reject status update kare.</li>
        </ul>
      </section>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">4) Troubleshooting (non-technical)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Check-in fail ho to GPS permission aur internet on rakhein.</li>
          <li>PIN fail ho to manager se PIN reset/register karwayein.</li>
          <li>Face issue ho to Identity page me “face update” flow follow karein.</li>
          <li>Data sync issue ho to Company/Config panel me Google Sheet test run karein.</li>
        </ul>
      </section>
    </div>
  )
}
