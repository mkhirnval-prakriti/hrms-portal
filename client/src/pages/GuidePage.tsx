export function GuidePage() {
  return (
    <div className="mx-auto max-w-[800px] space-y-5 pb-8 text-sm leading-relaxed text-[#14261a]">
      <h1 className="text-2xl font-bold text-[#1f5e3b]">System guide</h1>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">Attendance</h2>
        <p className="mt-2">
          Use GPS punch when on the move, or <strong>office location</strong> punch when you are at the branch
          (uses the branch coordinates configured by HR).
        </p>
      </section>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">Leaves</h2>
        <p className="mt-2">Staff apply → Manager review → Super Admin final approval.</p>
      </section>
      <section className="ph-card rounded-2xl p-6">
        <h2 className="font-semibold text-[#1f5e3b]">Payroll & documents</h2>
        <p className="mt-2">
          Payroll rows are stored per user per month. Upload PDF/images for KYC; HR marks documents as verified.
        </p>
      </section>
    </div>
  )
}
