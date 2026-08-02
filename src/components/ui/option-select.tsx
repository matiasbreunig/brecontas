"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  /** Plain-text label for the trigger, when `label` carries an icon or markup. */
  triggerLabel?: React.ReactNode;
}

interface OptionSelectProps {
  options: SelectOption[];
  /** Uncontrolled (form) usage — the value is submitted under this name. */
  name?: string;
  defaultValue?: string;
  /** Controlled usage. */
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "default";
  disabled?: boolean;
}

/**
 * A Select that shows its label instead of its raw value.
 *
 * base-ui renders items in a Portal, so a pre-filled `<SelectValue />` has
 * nothing mounted to read the label from and falls back to the raw value —
 * fields opened showing "expense", "__none__" or "checking" instead of
 * "Despesa", "Nenhum" or "Conta corrente". CLAUDE.md documents resolving the
 * label by hand in the trigger; doing it here means the ten call sites don't
 * each have to remember.
 *
 * Works uncontrolled (`name` + `defaultValue`, for plain forms) and controlled
 * (`value` + `onValueChange`).
 */
export function OptionSelect({
  options,
  name,
  defaultValue,
  value,
  onValueChange,
  placeholder = "Selecione...",
  className,
  size,
  disabled,
}: OptionSelectProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const current = isControlled ? value : internal;

  const selected = options.find((o) => o.value === current);

  const handleChange = (next: string) => {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <Select
      name={name}
      value={isControlled ? value : undefined}
      defaultValue={isControlled ? undefined : defaultValue}
      onValueChange={(v) => handleChange((v ?? "") as string)}
      disabled={disabled}
    >
      <SelectTrigger className={className} size={size}>
        {selected ? (
          <span className="flex flex-1 text-left truncate">
            {selected.triggerLabel ?? selected.label}
          </span>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
