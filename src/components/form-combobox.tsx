"use client";

import * as React from "react";
import { CategoryCombobox } from "@/components/category-combobox";
import { BeneficiaryCombobox } from "@/components/beneficiary-combobox";

/**
 * Searchable category/beneficiary pickers usable inside a plain `<form>`.
 *
 * CLAUDE.md requires a searchable combobox for these two — the lists are far
 * too long for a dropdown (48 categories to start with) — but the create forms
 * are uncontrolled and read their values from FormData on submit. These
 * wrappers keep the selection in state and mirror it into a hidden input, so
 * the form keeps working exactly as before.
 *
 * `emptyValue` is the sentinel the form already expects for "none" ("__none__").
 */

interface FormCategoryComboboxProps {
  name: string;
  categories: { id: string; name: string; icon: string | null }[];
  defaultValue?: string;
  emptyValue?: string;
  placeholder?: string;
  emptyLabel?: string;
}

export function FormCategoryCombobox({
  name,
  categories,
  defaultValue = "",
  emptyValue = "__none__",
  placeholder = "Buscar categoria...",
  emptyLabel = "Nenhuma",
}: FormCategoryComboboxProps) {
  const [value, setValue] = React.useState(
    defaultValue === emptyValue ? "" : defaultValue
  );

  return (
    <>
      <input type="hidden" name={name} value={value || emptyValue} />
      <CategoryCombobox
        categories={categories}
        value={value}
        onSelect={(id) => setValue(id ?? "")}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
      />
    </>
  );
}

interface FormBeneficiaryComboboxProps {
  name: string;
  beneficiaries: { id: string; name: string }[];
  defaultValue?: string;
  emptyValue?: string;
  placeholder?: string;
}

export function FormBeneficiaryCombobox({
  name,
  beneficiaries,
  defaultValue = "",
  emptyValue = "__none__",
  placeholder = "Buscar favorecido...",
}: FormBeneficiaryComboboxProps) {
  const [value, setValue] = React.useState(
    defaultValue === emptyValue ? "" : defaultValue
  );

  return (
    <>
      <input type="hidden" name={name} value={value || emptyValue} />
      <BeneficiaryCombobox
        beneficiaries={beneficiaries}
        value={value}
        onSelect={(id) => setValue(id ?? "")}
        placeholder={placeholder}
      />
    </>
  );
}
