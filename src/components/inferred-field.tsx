"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
export type FieldSource = "parsed" | "history" | "ocr" | "ai" | "default" | "user";

interface InferredFieldProps {
  source?: FieldSource;
  confidence?: number;
  isConfirmed?: boolean;
  children: React.ReactNode;
  className?: string;
}

const SOURCE_LABELS: Record<FieldSource, string> = {
  parsed: "Extraído do texto",
  history: "Baseado no histórico",
  ocr: "Extraído por OCR",
  ai: "Sugestão da IA",
  default: "Valor padrão",
  user: "Preenchido manualmente",
};

const SOURCE_COLORS: Record<FieldSource, string> = {
  parsed: "border-l-primary/60",
  history: "border-l-emerald-400",
  ocr: "border-l-amber-400",
  ai: "border-l-purple-400",
  default: "border-l-slate-300",
  user: "border-l-transparent",
};

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "Alta confiança";
  if (confidence >= 0.7) return "Média confiança";
  if (confidence >= 0.5) return "Baixa confiança";
  return "Muito baixa confiança";
}

export function InferredField({
  source,
  confidence,
  isConfirmed,
  children,
  className,
}: InferredFieldProps) {
  const isInferred = source && source !== "user" && source !== "default";
  const showIndicator = isInferred && !isConfirmed;

  if (!showIndicator) {
    return <div className={cn("space-y-1.5", className)}>{children}</div>;
  }

  const tooltipText = [
    SOURCE_LABELS[source],
    confidence != null ? `(${confidenceLabel(confidence)} — ${Math.round(confidence * 100)}%)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cn(
        "space-y-1.5 relative border-l-2 pl-2 -ml-2 transition-colors group/inferred",
        SOURCE_COLORS[source],
        className
      )}
      title={tooltipText}
    >
      {children}
      <div className="absolute -top-0.5 -right-1 opacity-60 group-hover/inferred:opacity-100 transition-opacity">
        <Sparkles className="h-3 w-3 text-primary/70" />
      </div>
    </div>
  );
}

/** Small inline badge showing field source */
export function InferredBadge({ source, confidence }: { source: FieldSource; confidence?: number }) {
  if (source === "user") return null;

  const badgeColors: Record<FieldSource, string> = {
    parsed: "bg-primary/5 text-primary",
    history: "bg-emerald-50 text-emerald-600",
    ocr: "bg-amber-50 text-amber-600",
    ai: "bg-purple-50 text-purple-600",
    default: "bg-slate-50 text-slate-500",
    user: "",
  };

  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full", badgeColors[source])}>
      <Sparkles className="h-2.5 w-2.5" />
      {SOURCE_LABELS[source]}
      {confidence != null && <span className="opacity-70">{Math.round(confidence * 100)}%</span>}
    </span>
  );
}
