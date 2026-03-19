"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import type { EntityType, UndoableAction } from "@/lib/undo-redo-types";

interface UseAutoSaveOptions<TValue> {
  entityType: EntityType;
  entityId: string;
  field: string;
  /** Current value from the server (from tRPC query) */
  serverValue: TValue;
  /** Execute the mutation. Should call mutateAsync and return void. */
  save: (value: TValue) => Promise<void>;
  /** Debounce in ms. 0 = immediate (for selects). 400 = text fields. */
  debounceMs?: number;
  /** Human-readable description for undo stack */
  description: string | ((oldVal: TValue, newVal: TValue) => string);
  /** Additional old/new values to include in the undo action (e.g., status auto-upgrade) */
  extraValues?: (value: TValue) => {
    oldExtra?: Record<string, unknown>;
    newExtra?: Record<string, unknown>;
  };
  /** Equality check. Default: strict equality for primitives, JSON for arrays. */
  isEqual?: (a: TValue, b: TValue) => boolean;
}

interface UseAutoSaveReturn<TValue> {
  value: TValue;
  setValue: (newValue: TValue) => void;
  isSaving: boolean;
}

function defaultIsEqual<T>(a: T, b: T): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function useAutoSave<TValue>({
  entityType,
  entityId,
  field,
  serverValue,
  save,
  debounceMs = 0,
  description,
  extraValues,
  isEqual = defaultIsEqual,
}: UseAutoSaveOptions<TValue>): UseAutoSaveReturn<TValue> {
  const [localValue, setLocalValue] = useState<TValue>(serverValue);
  const [isSaving, setIsSaving] = useState(false);
  const { pushAction } = useUndoRedo();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef(false);
  const savingRef = useRef(false);
  const serverValueRef = useRef(serverValue);
  const localValueRef = useRef(localValue);

  // Keep refs in sync
  serverValueRef.current = serverValue;
  localValueRef.current = localValue;

  // Sync from server when serverValue changes (after invalidation)
  // but only if no save is in flight or pending
  useEffect(() => {
    if (!pendingSaveRef.current && !isSaving) {
      setLocalValue(serverValue);
    }
  }, [serverValue, isSaving]);

  // Reset local value when entity changes
  useEffect(() => {
    setLocalValue(serverValue);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingSaveRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const executeSave = useCallback(
    async (newValue: TValue) => {
      // Re-entry guard: prevent concurrent saves corrupting the undo stack
      if (savingRef.current) return;

      const oldServerVal = serverValueRef.current;

      // Idempotent: skip if value hasn't changed from server
      if (isEqual(newValue, oldServerVal)) {
        pendingSaveRef.current = false;
        return;
      }

      savingRef.current = true;
      setIsSaving(true);
      pendingSaveRef.current = true;

      try {
        await save(newValue);

        const extra = extraValues?.(newValue);
        const desc =
          typeof description === "function"
            ? description(oldServerVal, newValue)
            : description;

        const action: UndoableAction = {
          type: field === "tagIds" ? "tags_update" : "field_update",
          entityType,
          entityId,
          oldValues: {
            [field]: oldServerVal,
            ...extra?.oldExtra,
          },
          newValues: {
            [field]: newValue,
            ...extra?.newExtra,
          },
          description: desc,
          timestamp: Date.now(),
        };

        pushAction(action);
        toast.success("Salvo", { id: "auto-save", duration: 1500 });
      } catch {
        // Revert to server value on error
        setLocalValue(serverValueRef.current);
        toast.error("Erro ao salvar", { id: "auto-save", duration: 3000 });
      } finally {
        savingRef.current = false;
        setIsSaving(false);
        pendingSaveRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityType, entityId, field, save, description, pushAction],
  );

  const setValue = useCallback(
    (newValue: TValue) => {
      setLocalValue(newValue);
      localValueRef.current = newValue;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (debounceMs <= 0) {
        // Immediate save
        executeSave(newValue);
      } else {
        pendingSaveRef.current = true;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          executeSave(localValueRef.current);
        }, debounceMs);
      }
    },
    [debounceMs, executeSave],
  );

  // Flush pending save on unmount (instead of silently dropping it)
  const executeSaveRef = useRef(executeSave);
  executeSaveRef.current = executeSave;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        // Fire the pending save with the latest local value
        executeSaveRef.current(localValueRef.current);
      }
    };
  }, []);

  return { value: localValue, setValue, isSaving };
}
