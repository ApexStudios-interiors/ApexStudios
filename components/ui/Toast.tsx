"use client";

import { useApp } from "@/context/AppContext";

export function Toast() {
  const { toastMsg } = useApp();
  return (
    <div
      className={`fixed bottom-5 right-5 z-[60] rounded-lg bg-foreground text-background px-4 py-3 text-[13.5px] font-medium shadow-[0_8px_30px_-10px_rgba(0,0,0,0.4)] pointer-events-none transition-all duration-200 ${
        toastMsg ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {toastMsg}
    </div>
  );
}
