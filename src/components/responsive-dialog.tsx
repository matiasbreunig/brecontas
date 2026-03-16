"use client";

import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

// ResponsiveDialog: renders as Dialog on desktop, bottom Sheet on mobile

interface ResponsiveDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function ResponsiveDialog({ open, onOpenChange, children }: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {children}
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

function ResponsiveDialogTrigger({ children, ...props }: React.ComponentProps<typeof DialogTrigger>) {
  const isMobile = useIsMobile();
  if (isMobile) return <SheetTrigger {...(props as React.ComponentProps<typeof SheetTrigger>)}>{children}</SheetTrigger>;
  return <DialogTrigger {...props}>{children}</DialogTrigger>;
}

function ResponsiveDialogContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <SheetContent side="bottom" className={`max-h-[90dvh] overflow-y-auto rounded-t-2xl ${className || ""}`} showCloseButton={false}>
        {/* Drag handle */}
        <div className="mx-auto mb-2 mt-1 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        {children}
      </SheetContent>
    );
  }

  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  );
}

function ResponsiveDialogHeader({ children, className, ...props }: React.ComponentProps<"div">) {
  const isMobile = useIsMobile();
  if (isMobile) return <SheetHeader className={className} {...props}>{children}</SheetHeader>;
  return <DialogHeader className={className} {...props}>{children}</DialogHeader>;
}

function ResponsiveDialogTitle({ children, ...props }: React.ComponentProps<typeof DialogTitle>) {
  const isMobile = useIsMobile();
  if (isMobile) return <SheetTitle {...(props as React.ComponentProps<typeof SheetTitle>)}>{children}</SheetTitle>;
  return <DialogTitle {...props}>{children}</DialogTitle>;
}

function ResponsiveDialogDescription({ children, ...props }: React.ComponentProps<typeof DialogDescription>) {
  const isMobile = useIsMobile();
  if (isMobile) return <SheetDescription {...(props as React.ComponentProps<typeof SheetDescription>)}>{children}</SheetDescription>;
  return <DialogDescription {...props}>{children}</DialogDescription>;
}

function ResponsiveDialogFooter({ children, className, ...props }: React.ComponentProps<"div">) {
  const isMobile = useIsMobile();
  if (isMobile) return <SheetFooter className={className} {...props}>{children}</SheetFooter>;
  return <DialogFooter className={className} {...props}>{children}</DialogFooter>;
}

function ResponsiveDialogClose({ children, ...props }: React.ComponentProps<typeof DialogClose>) {
  const isMobile = useIsMobile();
  if (isMobile) return <SheetClose {...(props as React.ComponentProps<typeof SheetClose>)}>{children}</SheetClose>;
  return <DialogClose {...props}>{children}</DialogClose>;
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogClose,
};
