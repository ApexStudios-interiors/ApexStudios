"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/layout/Sidebar";
import type { NavProject } from "@/components/layout/nav-project";

/**
 * Below `md` the 250px sidebar becomes this: a menu button in the top bar that
 * slides the same SidebarNav in from the left (APX-16). It is a Base UI dialog
 * underneath, so focus is trapped inside while open, Escape and the backdrop
 * close it, and focus returns to the menu button.
 *
 * Following any link inside closes it — caught on the way down, so it covers
 * nav links, package links and Docs. The project switcher navigates with
 * router.push instead, and closes it through `onNavigate`.
 */
export function MobileNav({ projects }: { projects: NavProject[] }) {
  const [open, setOpen] = useState(false);

  const closeOnLink = (target: EventTarget) => {
    if (target instanceof Element && target.closest("a[href]")) setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-sm" className="md:hidden -ml-1.5 flex-none" />}
        aria-label="Open navigation"
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] gap-0 bg-sidebar p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Projects, sections and your account</SheetDescription>
        <div
          className="flex h-full flex-col overflow-auto overscroll-contain p-3"
          onClickCapture={(e) => closeOnLink(e.target)}
        >
          <SidebarNav projects={projects} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
