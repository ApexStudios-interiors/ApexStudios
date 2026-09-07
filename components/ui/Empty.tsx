import { ReactNode } from "react";

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-10 text-center text-muted-foreground text-[13.5px]">{children}</div>;
}
