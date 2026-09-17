"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { createClientRecord } from "@/features/projects/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { inputClass } from "@/components/ui/DialogShell";

export type ClientOption = { id: string; name: string };

/**
 * The standard shadcn combobox (Popover + Command): type to filter the org's
 * clients, and when nothing matches the typed name exactly, offer to create it
 * without leaving the New Project dialog.
 *
 * Filtering is done here rather than by cmdk (`shouldFilter={false}`) so the
 * "Create" row can be decided on the same exact-match rule the list uses —
 * cmdk's fuzzy scorer would keep "T V Rao Housing" visible for "Rao" and leave
 * no clean way to tell "typed a new name" from "typed part of an old one".
 */
export function ClientCombobox({
  id,
  clients,
  value,
  onChange,
  onCreated,
  invalid,
}: {
  id: string;
  /** null while the list is still loading. */
  clients: ClientOption[] | null;
  value: string;
  onChange: (clientId: string) => void;
  onCreated: (client: ClientOption) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const create = useAction(createClientRecord, {
    onSuccess: ({ data }) => {
      if (!data) return;
      onCreated(data);
      onChange(data.id);
      setQuery("");
      setOpen(false);
    },
  });

  const selected = clients?.find((c) => c.id === value);
  const typed = query.trim();
  const needle = typed.toLowerCase();
  const matches = clients?.filter((c) => c.name.toLowerCase().includes(needle)) ?? [];
  const exactExists = clients?.some((c) => c.name.toLowerCase() === needle) ?? false;
  const canCreate = typed.length > 0 && !exactExists;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={!clients}
        aria-invalid={invalid || undefined}
        render={
          <button
            type="button"
            className={`${inputClass} flex items-center justify-between gap-2 text-left disabled:opacity-60 aria-invalid:border-destructive`}
          />
        }
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.name : clients ? "Select or create a client" : "Loading…"}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search or type a new client…" value={query} onValueChange={setQuery} />
          <CommandList>
            {!canCreate && <CommandEmpty>No clients yet. Type a name to create one.</CommandEmpty>}
            {matches.length > 0 && (
              <CommandGroup>
                {matches.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    data-checked={c.id === value}
                    onSelect={() => {
                      onChange(c.id);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  value={`__create__${typed}`}
                  disabled={create.isPending}
                  onSelect={() => create.execute({ name: typed })}
                >
                  <PlusIcon />
                  {create.isPending ? `Creating “${typed}”…` : `Create “${typed}”`}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          {create.result.serverError && (
            <p className="px-3 pb-2 text-xs text-destructive">{create.result.serverError}</p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
