import { describe, expect, it } from "vitest";
import { addDaysISO, parseISODate, toISODate, todayISO } from "@/lib/date";

/**
 * These run with TZ=America/Sao_Paulo (set in docker-compose.yml), which is what
 * makes "local" mean the domain's zone rather than the container's UTC default.
 */
describe("calendar dates", () => {
  it("keeps the calendar day for a late-evening instant", () => {
    // 2026-01-15 22:30 in Brasília is already 2026-01-16 in UTC. Formatting via
    // toISOString would report the 16th and file the entry on the wrong day —
    // and, at a month boundary, in the wrong month.
    const lateEvening = new Date(2026, 0, 15, 22, 30, 0);
    expect(toISODate(lateEvening)).toBe("2026-01-15");
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-01-16");
  });

  it("parses an ISO date as local midnight, not UTC midnight", () => {
    const d = parseISODate("2026-01-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
    // new Date("2026-01-15") is UTC midnight = the 14th at 21:00 in Brasília.
    expect(new Date("2026-01-15").getDate()).toBe(14);
  });

  it("survives a round trip", () => {
    for (const iso of ["2026-01-01", "2026-02-28", "2026-12-31"]) {
      expect(toISODate(parseISODate(iso))).toBe(iso);
    }
  });

  it("adds and subtracts days across month and year boundaries", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysISO("2026-03-01", -7)).toBe("2026-02-22");
  });

  it("crosses the DST-free Brazilian calendar without drift", () => {
    // Brazil dropped DST in 2019, but the arithmetic must not depend on that.
    expect(addDaysISO("2026-10-17", 1)).toBe("2026-10-18");
    expect(addDaysISO("2026-02-14", 1)).toBe("2026-02-15");
  });

  it("agrees with toISODate for today", () => {
    expect(todayISO()).toBe(toISODate(new Date()));
  });
});
