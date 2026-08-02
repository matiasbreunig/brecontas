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
  /**
   * Map the UI value to what the server stores, for fields whose empty state is
   * a UI sentinel (`""` for a cleared text field, `"__none__"` for a Select).
   *
   * The `save` callback already does this on the way out, but the undo action
   * did not: it recorded the raw UI value, so undoing sent `paymentMethod: ""`,
   * which zod rejects — and since the action only leaves the stack on success,
   * undo stayed wedged on it until the page was reloaded.
   */
  toServer?: (value: TValue) => unknown;
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
  toServer,
}: UseAutoSaveOptions<TValue>): UseAutoSaveReturn<TValue> {
  const [localValue, setLocalValue] = useState<TValue>(serverValue);
  const [isSaving, setIsSaving] = useState(false);
  const { pushAction } = useUndoRedo();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  /** Newest value typed while a save was in flight. Single slot: only the last one matters. */
  const queuedRef = useRef<{ value: TValue } | null>(null);
  const serverValueRef = useRef(serverValue);
  const localValueRef = useRef(localValue);
  const lastServerValueRef = useRef(serverValue);
  const isEqualRef = useRef(isEqual);

  // Keep refs in sync
  serverValueRef.current = serverValue;
  localValueRef.current = localValue;
  isEqualRef.current = isEqual;

  // Adopt the server value only when it actually changed — someone else edited
  // it, or our own save came back.
  //
  // The old condition was `!pendingSave && !isSaving`, which the save's own
  // `finally` made true before the refetch landed: the effect then re-ran with
  // the *stale* server value and pushed the field back to what it was, so a
  // freshly typed value visibly flickered back.
  useEffect(() => {
    const changed = !isEqualRef.current(serverValue, lastServerValueRef.current);
    lastServerValueRef.current = serverValue;
    if (!changed) return;
    if (savingRef.current || queuedRef.current || timerRef.current) return;
    setLocalValue(serverValue);
  }, [serverValue]);

  // Reset local value when entity changes
  useEffect(() => {
    setLocalValue(serverValue);
    lastServerValueRef.current = serverValue;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    queuedRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // Declared up front so executeSave can re-enter itself when draining the
  // queue, and so the unmount effect always sees the latest closure.
  const executeSaveRef = useRef<(value: TValue) => Promise<void>>(async () => {});

  const executeSave = useCallback(
    async (newValue: TValue) => {
      // A save is already in flight. Queue this value instead of dropping it —
      // dropping is what made a second quick edit vanish while the UI still said
      // "Salvo", and it swallowed the unmount flush too.
      if (savingRef.current) {
        queuedRef.current = { value: newValue };
        return;
      }

      const oldServerVal = serverValueRef.current;

      // Idempotent: skip if value hasn't changed from server
      if (isEqual(newValue, oldServerVal)) {
        return;
      }

      savingRef.current = true;
      setIsSaving(true);

      try {
        await save(newValue);

        const extra = extraValues?.(newValue);
        const desc =
          typeof description === "function"
            ? description(oldServerVal, newValue)
            : description;

        // The undo action carries the server representation, so replaying it
        // through the mutation is valid input — not a UI sentinel.
        const forServer = toServer ?? ((v: TValue) => v as unknown);

        const action: UndoableAction = {
          type: field === "tagIds" ? "tags_update" : "field_update",
          entityType,
          entityId,
          oldValues: {
            [field]: forServer(oldServerVal),
            ...extra?.oldExtra,
          },
          newValues: {
            [field]: forServer(newValue),
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
        queuedRef.current = null;
        toast.error("Erro ao salvar", { id: "auto-save", duration: 3000 });
      } finally {
        savingRef.current = false;
        setIsSaving(false);

        // Drain: whatever was typed while this save was in flight goes next.
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued && !isEqual(queued.value, newValue)) {
          void executeSaveRef.current(queued.value);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityType, entityId, field, save, description, pushAction, toServer],
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
        void executeSave(newValue);
      } else {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void executeSave(localValueRef.current);
        }, debounceMs);
      }
    },
    [debounceMs, executeSave],
  );

  executeSaveRef.current = executeSave;

  // Flush a pending edit on unmount — closing the row or navigating away must
  // not drop what was typed. If a save is in flight the queue takes it, so it
  // still lands.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void executeSaveRef.current(localValueRef.current);
      }
    };
  }, []);

  return { value: localValue, setValue, isSaving };
}
