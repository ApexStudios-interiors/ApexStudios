"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `yyyy-mm-dd` -> `Date` on the LOCAL calendar day. `new Date("2026-09-17")`
 * would parse as UTC midnight and render as the 16th anywhere west of UTC;
 * building it from parts keeps the highlighted day equal to the stored string
 * in every timezone.
 */
export function fromIsoDate(value: string): Date | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `Date` -> `yyyy-mm-dd` from the LOCAL calendar day — the exact inverse of
 *  `fromIsoDate`, and the same string shape a native `<input type="date">`
 *  produced, so nothing downstream of the form sees a different value. */
export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The shadcn date-picker composition (Calendar in a Popover), as a drop-in for
 * `<input type="date">`: it takes and emits the same `yyyy-mm-dd` string, and
 * `""` for "no date", exactly as the native input did.
 *
 * `required` stops a re-click on the selected day from clearing the value —
 * for fields whose schema has no empty state (e.g. a payment's `paidOn`).
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  required = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromIsoDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button id={id} type="button" variant="outline" disabled={disabled} className="w-full" />}
      >
        <span className={cn("flex-1 text-left font-normal", !selected && "text-muted-foreground")}>
          {selected ? format(selected, "d MMM yyyy") : placeholder}
        </span>
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) {
              if (required) return;
              onChange("");
            } else {
              onChange(toIsoDate(date));
            }
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
