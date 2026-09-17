"use client";

import { type Ref, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { inputClass } from "@/components/ui/DialogShell";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** dd/MM/yyyy — how a date is written on an Indian site record. */
const DISPLAY_DATE = "dd/MM/yyyy";

/**
 * `yyyy-MM-dd` -> `Date` on the LOCAL calendar day. `new Date("2026-09-17")`
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

/** `Date` -> `yyyy-MM-dd` from the LOCAL calendar day — the exact inverse of
 *  `fromIsoDate`, and the same string shape a native `<input type="date">`
 *  produced, so nothing downstream of the form sees a different value.
 *  Never `toISOString()`: on a calendar-picked local midnight that rolls the
 *  day back for everyone east of Greenwich, which is every user of this app. */
export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The one date picker in this app — the shadcn composition (Calendar in a
 * Popover) standing in for the `<input type="date">` every date field used to
 * be. It takes and emits the same `yyyy-MM-dd` string that input produced, and
 * `""` for "no date", so every zod schema (`z.iso.date()`) and everything
 * downstream of a form is untouched; only the display is `dd/MM/yyyy`.
 *
 * It replaces three near-identical implementations (this one, schedule's
 * `DatePickerField`, and an inline Popover+Calendar in PostUpdateDialog).
 *
 * `ref` and `onBlur` are forwarded so a react-hook-form `Controller` can
 * register it like any other field. `required` stops a re-click on the
 * selected day from clearing the value — for fields whose schema has no empty
 * state (a task's start date, a payment's `paidOn`).
 */
export function DatePicker({
  id,
  value,
  onChange,
  onBlur,
  ref,
  placeholder = "Pick a date",
  disabled = false,
  required = false,
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ref?: Ref<HTMLButtonElement>;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? fromIsoDate(value) : undefined;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <PopoverTrigger
        id={id}
        ref={ref}
        disabled={disabled}
        data-empty={!selected}
        className={`${inputClass} flex items-center gap-2 text-left disabled:opacity-60 data-[empty=true]:text-muted-foreground`}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        {selected ? format(selected, DISPLAY_DATE) : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (date) onChange(toIsoDate(date));
            else if (!required) onChange("");
            setOpen(false);
            onBlur?.();
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
