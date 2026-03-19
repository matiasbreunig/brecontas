"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { ImportWizard } from "./import-wizard";

interface ImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function ImportSheet({ open, onOpenChange, onComplete }: ImportSheetProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onOpenChange(false); }}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Importar Extrato</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ImportWizard
          compact
          onComplete={() => onComplete?.()}
          onClose={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
