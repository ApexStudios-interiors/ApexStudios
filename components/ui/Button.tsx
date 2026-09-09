import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "default" | "primary" | "ghost" | "destructive";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  default: "bg-background border-input hover:bg-accent",
  primary: "bg-primary text-primary-foreground border-primary hover:opacity-90",
  ghost: "bg-transparent border-transparent hover:bg-accent",
  destructive:
    "bg-background border-input text-foreground hover:bg-foreground hover:text-background hover:border-foreground",
};

const sizes: Record<Size, string> = {
  md: "h-9 px-3.5 text-[13.5px]",
  sm: "h-[30px] px-2.5 text-[12.5px]",
};

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
