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

/**
 * Calendar date in the local zone. The container runs with
 * TZ=America/Sao_Paulo (docker-compose.yml), so "local" is the domain's zone.
 *
 * Never use `toISOString().split("T")[0]` for a calendar date: it is UTC, so
 * anything logged after 21:00 in Brasília lands on the next day — and on the
 * turn of a month, in the next month, for both cash and accrual dates.
 */
export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Today, as a calendar date in the domain's zone. */
export function todayISO(): string {
  return toISODate(new Date());
}

/**
 * Parse "yyyy-MM-dd" as local midnight.
 *
 * `new Date("2026-01-15")` is UTC midnight, which in Brasília is the 14th at
 * 21:00 — so date arithmetic on it silently shifts a day.
 */
export function parseISODate(isoDate: string): Date {
  return parse(isoDate, "yyyy-MM-dd", new Date());
}

/** Calendar date `days` away from an ISO date, staying in the local zone. */
export function addDaysISO(isoDate: string, days: number): string {
  const d = parseISODate(isoDate);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function parseBRDate(dateStr: string): Date {
  return parse(dateStr, "dd/MM/yyyy", new Date());
}

export function nowTimestamp(): Date {
  return new Date();
}
