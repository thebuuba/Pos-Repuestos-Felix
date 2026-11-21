// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AppSidebar } from "../components/app-sidebar.jsx";
import { Sheet } from "../../components/ui/sheet.jsx";
import { SheetContent } from "../../components/ui/sheet.jsx";
import { SheetTitle } from "../../components/ui/sheet.jsx";
import { TopBar } from "../components/top-bar.jsx";
import { useState } from "react";
function PosLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border lg:block">
        <AppSidebar />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">{"Menú de navegación"}</SheetTitle>
          <AppSidebar onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
export { PosLayout };
