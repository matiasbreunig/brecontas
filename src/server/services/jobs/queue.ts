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

/**
 * @param permanent for failures a retry cannot fix — an unknown job type, a
 * malformed payload. Retrying those just burns the attempts and delays the
 * moment the row finally reads "failed".
 */
export function failJob(jobId: string, error: string, permanent = false): void {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return;

  const attempts = job.attempts || 0;
  const shouldRetry = !permanent && attempts < (job.maxAttempts || 3);

  // Back off before the next attempt. Returning the job straight to "pending"
  // would make the worker pick it up on the very next tick and burn all three
  // attempts in a few seconds — useless against the thing retries exist for,
  // which is a provider being briefly unavailable.
  const backoffSeconds = Math.min(300, 15 * 2 ** (attempts - 1));
  const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

  db.update(jobs)
    .set({
      status: shouldRetry ? "pending" : "failed",
      error,
      scheduledAt: shouldRetry ? nextAttemptAt : job.scheduledAt,
      startedAt: null,
      completedAt: shouldRetry ? null : nowTimestamp(),
    })
    .where(eq(jobs.id, jobId))
    .run();
}

/**
 * Jobs left mid-flight when the process died.
 *
 * Nothing reset them before, because nothing ever looked at the queue: a job
 * that was "running" when the container restarted stayed that way forever.
 */
export function requeueStaleJobs(staleAfterSeconds = 10 * 60): number {
  const cutoff = Math.floor(Date.now() / 1000) - staleAfterSeconds;

  return db
    .update(jobs)
    .set({ status: "pending", startedAt: null })
    .where(
      and(
        eq(jobs.status, "running"),
        sql`COALESCE(started_at, 0) < ${cutoff}`
      )
    )
    .run().changes;
}

export function getJobStatus(jobId: string) {
  return db.select().from(jobs).where(eq(jobs.id, jobId)).get();
}
