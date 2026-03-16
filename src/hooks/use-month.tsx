"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth } from "date-fns";

interface MonthContextType {
  /** Current selected month as Date (first day of month) */
  month: Date;
  /** ISO date string for start of month: "2026-03-01" */
  dateFrom: string;
  /** ISO date string for end of month: "2026-03-31" */
  dateTo: string;
  /** "2026-03" format for competence matching */
  competence: string;
  /** Navigate to previous month */
  prevMonth: () => void;
  /** Navigate to next month */
  nextMonth: () => void;
  /** Navigate to specific month */
  setMonth: (date: Date) => void;
  /** Navigate to current month */
  goToToday: () => void;
  /** Whether currently viewing the current month */
  isCurrentMonth: boolean;
}

const MonthContext = createContext<MonthContextType | null>(null);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonthState] = useState(() => startOfMonth(new Date()));

  const dateFrom = format(month, "yyyy-MM-dd");
  const dateTo = format(endOfMonth(month), "yyyy-MM-dd");
  const competence = format(month, "yyyy-MM");

  const now = startOfMonth(new Date());
  const isCurrentMonth = format(month, "yyyy-MM") === format(now, "yyyy-MM");

  const prevMonth = useCallback(() => setMonthState((m) => subMonths(m, 1)), []);
  const nextMonth = useCallback(() => setMonthState((m) => addMonths(m, 1)), []);
  const setMonth = useCallback((date: Date) => setMonthState(startOfMonth(date)), []);
  const goToToday = useCallback(() => setMonthState(startOfMonth(new Date())), []);

  return (
    <MonthContext.Provider
      value={{ month, dateFrom, dateTo, competence, prevMonth, nextMonth, setMonth, goToToday, isCurrentMonth }}
    >
      {children}
    </MonthContext.Provider>
  );
}

export function useMonth() {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error("useMonth must be used within MonthProvider");
  return ctx;
}
