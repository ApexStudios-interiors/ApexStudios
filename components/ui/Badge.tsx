import { ReactNode } from "react";

type Variant = "default" | "secondary" | "outline";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground border-transparent",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  outline: "bg-transparent text-foreground border-border-strong",
};

export function Badge({
  variant = "outline",
  children,
  className = "",
}: {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
