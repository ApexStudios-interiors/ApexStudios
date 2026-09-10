import type { ReactNode } from "react";

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[680px] [&>tbody>tr:last-child>td]:border-b-0">
        {children}
      </table>
    </div>
  );
}
