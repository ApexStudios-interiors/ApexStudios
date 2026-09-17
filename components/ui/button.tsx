import { type ButtonHTMLAttributes, forwardRef } from "react";

/**
 * Lives at the lowercase path every generated shadcn component imports
 * (`@/components/ui/button`). macOS would have resolved `Button.tsx` too;
 * Vercel's Linux build would not, so the casing is load-bearing, not cosmetic.
 *
 * The repo's own four variants and two sizes are unchanged — the 13 existing
 * call sites keep working. The rest are aliases onto them so a shadcn
 * component asking for `variant="outline"` or `size="icon"` renders correctly
 * instead of falling through to `undefined`.
 */
type Variant = "default" | "primary" | "ghost" | "destructive" | "outline" | "secondary" | "link";
type Size = "md" | "sm" | "default" | "lg" | "icon" | "icon-sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  default: "bg-background border-input hover:bg-accent",
  primary: "bg-primary text-primary-foreground border-primary hover:opacity-90",
  ghost: "bg-transparent border-transparent hover:bg-accent",
  destructive:
    "bg-background border-input text-foreground hover:bg-foreground hover:text-background hover:border-foreground",
  // shadcn aliases onto the existing four — no new colour enters the palette,
  // which is the point of the monochrome rule in AGENTS.md.
  outline: "bg-background border-input hover:bg-accent",
  secondary: "bg-muted border-transparent hover:bg-accent",
  link: "bg-transparent border-transparent underline underline-offset-4 hover:opacity-80",
};

const sizes: Record<Size, string> = {
  md: "h-9 px-3.5 text-[13.5px]",
  sm: "h-[30px] px-2.5 text-[12.5px]",
  default: "h-9 px-3.5 text-[13.5px]",
  lg: "h-10 px-4 text-[14px]",
  icon: "size-9 p-0",
  "icon-sm": "size-8 p-0",
};

/**
 * Generated shadcn components (calendar, dialog) import this to style a
 * non-button element as one. Same lookup the component itself uses, so the
 * two can never drift apart.
 */
export function buttonVariants({
  variant = "default",
  size = "md",
}: { variant?: Variant; size?: Size } = {}): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", className = "", ...props },
  ref
) {
  return (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />
  );
});
