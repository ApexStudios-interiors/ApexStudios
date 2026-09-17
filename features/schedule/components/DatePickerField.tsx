"use client";

import { type Ref, useState } from "react";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { inputClass } from "@/components/ui/DialogShell";

const ISO_DATE = "yyyy-MM-dd";
/** dd/MM/yyyy — how a date is written on an Indian site record. */
const DISPLAY_DATE = "dd/MM/yyyy";

function isoToDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, ISO_DATE, new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The shadcn date-picker composition (Popover + Calendar) standing in for the
 * `<input type="date">` both task dialogs used. The value in and out is the
 * same `yyyy-MM-dd` string that input produced, so `createTaskSchema` /
 * `updateTaskSchema`'s `z.iso.date()` and everything downstream of them are
 * untouched — only the display is `dd/MM/yyyy`.
 *
 * Parse and format both run in local time on purpose: the calendar hands back
 * a local midnight, and `toISOString()` on that would roll the day back across
 * the UTC boundary for anyone east of Greenwich — every user of this app.
 *
 * No clearing: a picked day cannot be un-picked (`required`). Neither schema
 * accepts `""` for a start date, so the native input's clear button only ever
 * produced a validation error.
 */
export function DatePickerField({
  id,
  value,
  onChange,
  onBlur,
  ref,
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);

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
        data-empty={!selected}
        className={`${inputClass} flex items-center gap-2 text-left data-[empty=true]:text-muted-foreground`}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        {selected ? format(selected, DISPLAY_DATE) : "Pick a date"}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(format(date, ISO_DATE));
            setOpen(false);
            onBlur?.();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
