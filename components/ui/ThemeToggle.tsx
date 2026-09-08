"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Reads theme state from the DOM/browser, which only exists on the client - this can't
    // be known during the server render, so a post-mount effect is the correct approach here.
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore storage errors (private mode, disabled storage, etc.)
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="h-8 w-8 grid place-items-center rounded-lg border border-input hover:bg-accent text-muted-foreground outline-none focus-visible:bg-accent"
    >
      {theme && <Icon name={theme === "dark" ? "sun" : "moon"} className="w-4 h-4" />}
    </button>
  );
}
