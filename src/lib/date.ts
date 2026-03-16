import { format, parse, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function formatDateBR(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

export function formatDateTimeBR(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

export function formatMonthYear(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "MMMM yyyy", { locale: ptBR });
}

export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseBRDate(dateStr: string): Date {
  return parse(dateStr, "dd/MM/yyyy", new Date());
}

export function nowTimestamp(): Date {
  return new Date();
}
