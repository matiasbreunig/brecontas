import { db } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

type JobType = "import_parse" | "ai_classify" | "ai_classify_batch" | "ocr_extract" | "generate_projections" | "reclassify";

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  userId?: string
): Promise<string> {
  const id = generateId();
  const now = nowTimestamp();

  db.insert(jobs).values({
    id,
    userId: userId ?? null,
    type,
    status: "pending",
    payload: JSON.stringify(payload),
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: now,
    createdAt: now,
  }).run();

  return id;
}

export function dequeueJob(): typeof jobs.$inferSelect | null {
  const job = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "pending"),
        sql`scheduled_at <= ${Math.floor(Date.now() / 1000)}`
      )
    )
    .orderBy(asc(jobs.scheduledAt))
    .limit(1)
    .get();

  if (!job) return null;

  // Atomically claim the job
  const result = db
    .update(jobs)
    .set({
      status: "running",
      startedAt: nowTimestamp(),
      attempts: sql`attempts + 1`,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
    .run();

  if (result.changes === 0) return null; // Another worker claimed it

  return { ...job, status: "running" };
}

export function completeJob(jobId: string, result?: Record<string, unknown>): void {
  db.update(jobs)
    .set({
      status: "completed",
      result: result ? JSON.stringify(result) : null,
      completedAt: nowTimestamp(),
    })
    .where(eq(jobs.id, jobId))
    .run();
}

export function failJob(jobId: string, error: string): void {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return;

  const shouldRetry = (job.attempts || 0) < (job.maxAttempts || 3);

  db.update(jobs)
    .set({
      status: shouldRetry ? "pending" : "failed",
      error,
      completedAt: shouldRetry ? null : nowTimestamp(),
    })
    .where(eq(jobs.id, jobId))
    .run();
}

export function getJobStatus(jobId: string) {
  return db.select().from(jobs).where(eq(jobs.id, jobId)).get();
}
