/**
 * build/03-auth-and-rbac.md §2.7: outside the app shell — no sidebar, no
 * header. This is the first screen every user sees; the visual language is
 * the same monochrome card/button treatment as the dialogs, not a new one.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-[30px] h-[30px] rounded-[7px] bg-primary text-primary-foreground grid place-items-center font-bold text-[13px]">
            A
          </div>
          <div className="font-bold text-sm">Apex Projects</div>
        </div>
        {children}
      </div>
    </div>
  );
}
