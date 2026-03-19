"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

interface Tag {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

interface TagMultiSelectProps {
  tags: Tag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onCreate?: (name: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  red: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  yellow: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  green: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  pink: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
};

function getTagStyle(color: string | null) {
  if (color && TAG_COLORS[color]) return TAG_COLORS[color];
  return { bg: "bg-muted", text: "text-foreground", border: "border-border" };
}

export function TagMultiSelect({
  tags,
  selectedIds,
  onChange,
  onCreate,
  placeholder = "Tags...",
  className,
  disabled,
  size = "default",
}: TagMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedTags = tags.filter((t) => selectedIds.includes(t.id));
  const searchNorm = search.toLowerCase().trim();
  const exactMatch = tags.some((t) => t.name.toLowerCase() === searchNorm);

  function toggleTag(tagId: string) {
    if (selectedIds.includes(tagId)) {
      onChange(selectedIds.filter((id) => id !== tagId));
    } else {
      onChange([...selectedIds, tagId]);
    }
  }

  function removeTag(tagId: string) {
    onChange(selectedIds.filter((id) => id !== tagId));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start font-normal gap-1 flex-wrap",
              size === "sm" ? "h-auto min-h-9 py-1 px-2" : "h-auto min-h-[44px] py-1.5 px-2.5",
              !selectedTags.length && "text-muted-foreground",
              className,
            )}
            disabled={disabled}
          />
        }
      >
        {selectedTags.length > 0 ? (
          <>
            {selectedTags.map((tag) => {
              const style = getTagStyle(tag.color);
              return (
                <span
                  key={tag.id}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border",
                    style.bg,
                    style.text,
                    style.border,
                  )}
                >
                  {tag.icon && <span>{tag.icon}</span>}
                  {tag.name}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      removeTag(tag.id);
                    }}
                    className="hover:opacity-70 -mr-0.5"
                    aria-label={`Remover tag ${tag.name}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </>
        ) : (
          <span className="text-sm">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Buscar ou criar tag..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="py-3 text-center text-sm">
              {search.trim().length > 0 && onCreate ? (
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={() => {
                    onCreate(search.trim());
                    setSearch("");
                  }}
                >
                  <Plus className="h-4 w-4 text-emerald-600" />
                  <span>
                    Criar tag <strong>&quot;{search.trim()}&quot;</strong>
                  </span>
                </button>
              ) : (
                "Nenhuma tag encontrada."
              )}
            </CommandEmpty>
            <CommandGroup>
              {tags.map((tag) => {
                const isSelected = selectedIds.includes(tag.id);
                const style = getTagStyle(tag.color);
                return (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => toggleTag(tag.id)}
                    data-checked={isSelected ? "true" : undefined}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border",
                        style.bg,
                        style.text,
                        style.border,
                      )}
                    >
                      {tag.icon && <span>{tag.icon}</span>}
                      {tag.name}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {search.trim().length > 0 && !exactMatch && tags.length > 0 && onCreate && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__create__${search.trim()}`}
                    onSelect={() => {
                      onCreate(search.trim());
                      setSearch("");
                    }}
                  >
                    <Plus className="h-4 w-4 text-emerald-600" />
                    Criar tag &quot;{search.trim()}&quot;
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

export { getTagStyle };
