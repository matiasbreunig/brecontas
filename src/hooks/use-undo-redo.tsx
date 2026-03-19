"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { UndoableAction, EntityType } from "@/lib/undo-redo-types";

const MAX_STACK_SIZE = 50;

interface UndoRedoContextType {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
  pushAction: (action: UndoableAction) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  isProcessing: boolean;
}

const UndoRedoContext = createContext<UndoRedoContextType | null>(null);

export function UndoRedoProvider({ children }: { children: ReactNode }) {
  const [past, setPast] = useState<UndoableAction[]>([]);
  const [future, setFuture] = useState<UndoableAction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  const utils = trpc.useUtils();

  // Mutations for each entity type (used for undo/redo execution)
  const updateTransaction = trpc.transactions.update.useMutation();
  const restoreTransaction = trpc.transactions.restore.useMutation();
  const deleteTransaction = trpc.transactions.delete.useMutation();
  const updateBeneficiary = trpc.beneficiaries.update.useMutation();
  const updateCategory = trpc.categories.update.useMutation();
  const updateTag = trpc.tags.update.useMutation();
  const updateAccount = trpc.accounts.update.useMutation();

  const invalidateEntity = useCallback(
    (entityType: EntityType) => {
      switch (entityType) {
        case "transactions":
          utils.transactions.invalidate();
          break;
        case "beneficiaries":
          utils.beneficiaries.invalidate();
          break;
        case "categories":
          utils.categories.invalidate();
          break;
        case "tags":
          utils.tags.invalidate();
          break;
        case "accounts":
          utils.accounts.invalidate();
          break;
      }
    },
    [utils],
  );

  /**
   * Execute a mutation to apply the given values to an entity.
   * Handles special cases like status_change (discard → restore, restore → discard).
   */
  const executeMutation = useCallback(
    async (action: UndoableAction, values: Record<string, unknown>) => {
      const { entityType, entityId } = action;

      // Special case: status_change uses discard/restore endpoints
      if (entityType === "transactions" && action.type === "status_change") {
        if (values.status === "discarded") {
          await deleteTransaction.mutateAsync({
            id: entityId,
            reason: (values.discardReason as "duplicate" | "error" | "irrelevant" | "merged") ?? "error",
          });
        } else {
          // Restoring from discarded, or reverting a reconcile — use restore or update
          await restoreTransaction.mutateAsync({ id: entityId });
        }
        return;
      }

      // Standard field/tag updates
      switch (entityType) {
        case "transactions":
          await updateTransaction.mutateAsync({
            id: entityId,
            ...values,
          } as Parameters<typeof updateTransaction.mutateAsync>[0]);
          break;
        case "beneficiaries":
          await updateBeneficiary.mutateAsync({
            id: entityId,
            ...values,
          } as Parameters<typeof updateBeneficiary.mutateAsync>[0]);
          break;
        case "categories":
          await updateCategory.mutateAsync({
            id: entityId,
            ...values,
          } as Parameters<typeof updateCategory.mutateAsync>[0]);
          break;
        case "tags":
          await updateTag.mutateAsync({
            id: entityId,
            ...values,
          } as Parameters<typeof updateTag.mutateAsync>[0]);
          break;
        case "accounts":
          await updateAccount.mutateAsync({
            id: entityId,
            ...values,
          } as Parameters<typeof updateAccount.mutateAsync>[0]);
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pushAction = useCallback((action: UndoableAction) => {
    setPast((prev) => {
      const next = [...prev, action];
      if (next.length > MAX_STACK_SIZE) next.shift();
      return next;
    });
    setFuture([]);
  }, []);

  // Refs to avoid stale closures in undo/redo — updated synchronously during render
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  pastRef.current = past;
  futureRef.current = future;

  const undo = useCallback(async () => {
    if (processingRef.current) return;
    const action = pastRef.current[pastRef.current.length - 1];
    if (!action) return;

    processingRef.current = true;
    setIsProcessing(true);

    try {
      await executeMutation(action, action.oldValues);
      invalidateEntity(action.entityType);

      setPast((prev) => prev.slice(0, -1));
      setFuture((prev) => [...prev, action]);

      toast("Ação desfeita", {
        description: action.description,
        id: "undo-redo",
        duration: 3000,
        action: {
          label: "Refazer",
          onClick: () => redoRef.current?.(),
        },
      });
    } catch {
      toast.error("Erro ao desfazer", { id: "undo-redo", duration: 3000 });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [executeMutation, invalidateEntity]);

  const redo = useCallback(async () => {
    if (processingRef.current) return;
    const action = futureRef.current[futureRef.current.length - 1];
    if (!action) return;

    processingRef.current = true;
    setIsProcessing(true);

    try {
      await executeMutation(action, action.newValues);
      invalidateEntity(action.entityType);

      setFuture((prev) => prev.slice(0, -1));
      setPast((prev) => {
        const next = [...prev, action];
        if (next.length > MAX_STACK_SIZE) next.shift();
        return next;
      });

      toast("Ação refeita", {
        description: action.description,
        id: "undo-redo",
        duration: 3000,
        action: {
          label: "Desfazer",
          onClick: () => undoRef.current?.(),
        },
      });
    } catch {
      toast.error("Erro ao refazer", { id: "undo-redo", duration: 3000 });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [executeMutation, invalidateEntity]);

  // Stable refs for toast callbacks — updated synchronously during render
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  // Global keyboard shortcut: Cmd+Z / Cmd+Shift+Z
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== "z") return;

      // Don't intercept when a text input is focused (browser handles native undo)
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();

      if (e.shiftKey) {
        redoRef.current?.();
      } else {
        undoRef.current?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const lastPast = past[past.length - 1];
  const lastFuture = future[future.length - 1];

  return (
    <UndoRedoContext.Provider
      value={{
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        undoDescription: lastPast?.description ?? null,
        redoDescription: lastFuture?.description ?? null,
        pushAction,
        undo,
        redo,
        isProcessing,
      }}
    >
      {children}
    </UndoRedoContext.Provider>
  );
}

export function useUndoRedo() {
  const ctx = useContext(UndoRedoContext);
  if (!ctx) throw new Error("useUndoRedo must be used within UndoRedoProvider");
  return ctx;
}
