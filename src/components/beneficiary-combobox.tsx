"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";

interface Beneficiary {
  id: string;
  name: string;
}

interface BeneficiaryComboboxProps {
  beneficiaries: Beneficiary[];
  value?: string; // beneficiary ID
  freeText?: string; // free text when no existing match
  onSelect: (beneficiaryId: string | undefined, freeText?: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function BeneficiaryCombobox({
  beneficiaries,
  value,
  freeText,
  onSelect,
  placeholder = "Selecionar beneficiário...",
  className,
  disabled,
}: BeneficiaryComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selected = beneficiaries.find((b) => b.id === value);
  const displayValue = selected?.name || freeText || "";

  // Check if current search term matches any existing beneficiary
  const searchNorm = search.toLowerCase().trim();
  const exactMatch = beneficiaries.some(
    (b) => b.name.toLowerCase() === searchNorm
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-between min-h-[44px] sm:min-h-[36px] font-normal",
              !displayValue && "text-muted-foreground",
              className
            )}
            disabled={disabled}
          />
        }
      >
        <span className="truncate">
          {displayValue || placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Buscar ou digitar novo..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="py-3 text-center text-sm">
              {search.trim().length > 0 ? (
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={() => {
                    onSelect(undefined, search.trim());
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Plus className="h-4 w-4 text-emerald-600" />
                  <span>
                    Criar <strong>&quot;{search.trim()}&quot;</strong>
                  </span>
                </button>
              ) : (
                "Nenhum beneficiário encontrado."
              )}
            </CommandEmpty>
            <CommandGroup>
              {beneficiaries.map((b) => (
                <CommandItem
                  key={b.id}
                  value={b.name}
                  onSelect={() => {
                    onSelect(b.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-checked={value === b.id ? "true" : undefined}
                >
                  {b.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {search.trim().length > 0 && !exactMatch && beneficiaries.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__create__${search.trim()}`}
                    onSelect={() => {
                      onSelect(undefined, search.trim());
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Plus className="h-4 w-4 text-emerald-600" />
                    Criar &quot;{search.trim()}&quot;
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
