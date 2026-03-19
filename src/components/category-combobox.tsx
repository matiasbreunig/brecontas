"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";

interface Category {
  id: string;
  name: string;
  icon: string | null;
}

interface CategoryComboboxProps {
  categories: Category[];
  value?: string; // category ID or "" for none
  onSelect: (categoryId: string | undefined) => void;
  placeholder?: string;
  emptyLabel?: string; // shown as first option, e.g. "Nenhuma" or "Nenhum (raiz)"
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}

export function CategoryCombobox({
  categories,
  value,
  onSelect,
  placeholder = "Selecionar categoria...",
  emptyLabel,
  className,
  disabled,
  size = "default",
}: CategoryComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selected = value ? categories.find((c) => c.id === value) : undefined;

  const displayValue = selected
    ? `${selected.icon ? selected.icon + " " : ""}${selected.name}`
    : emptyLabel ?? "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-between font-normal",
              size === "sm" ? "h-9 text-sm" : "min-h-[44px] sm:min-h-[36px]",
              !selected && "text-muted-foreground",
              className,
            )}
            disabled={disabled}
          />
        }
      >
        <span className="truncate">{displayValue || placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Buscar categoria..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Nenhuma categoria encontrada.</CommandEmpty>
            <CommandGroup>
              {emptyLabel && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onSelect(undefined);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <span className="flex-1 text-muted-foreground">{emptyLabel}</span>
                  {!value && <Check className="h-3.5 w-3.5 text-primary" />}
                </CommandItem>
              )}
              {categories.map((cat) => (
                <CommandItem
                  key={cat.id}
                  value={`${cat.icon ?? ""} ${cat.name}`}
                  onSelect={() => {
                    onSelect(cat.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  {cat.icon && <span className="mr-1">{cat.icon}</span>}
                  <span className="flex-1">{cat.name}</span>
                  {value === cat.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
