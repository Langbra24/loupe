import { AppShell } from "@/components/shell/app-shell"
import { DesktopOnlyNotice } from "@/components/shell/desktop-only-notice"

export default function Page() {
  return (
    <>
      <div className="hidden lg:block">
        <AppShell />
      </div>
      <DesktopOnlyNotice className="lg:hidden" />
    </>
  )
}
