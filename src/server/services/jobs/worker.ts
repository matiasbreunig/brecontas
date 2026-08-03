import { jobs } from "@/server/db/schema";
import { classifyBatch } from "@/server/services/ai/classifier";
import { completeJob, dequeueJob, failJob, requeueStaleJobs } from "./queue";

type Job = typeof jobs.$inferSelect;

/**
 * The queue's consumer.
 *
 * `queue.ts` had enqueue, atomic claim, retry and attempt counting — and no
 * caller for `dequeueJob`, so nothing ever ran. Background work was instead
 * fire-and-forget promises: no retry, and any failure died in a console line.
 *
 * One process, one loop. Claiming is atomic (`dequeueJob` only wins if the row
 * is still `pending`), so a second instance would be safe, but there is only
 * ever one here.
 */

const POLL_INTERVAL_MS = 5_000;

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<Record<string, unknown> | void>;

const handlers: Partial<Record<Job["type"], Handler>> = {
  ai_classify_batch: async (payload) => {
    const transactionIds = payload.transactionIds;
    const userId = payload.userId;
    if (!Array.isArray(transactionIds) || typeof userId !== "string") {
      throw new Error("Payload inválido para ai_classify_batch");
    }
    return classifyBatch(transactionIds as string[], userId);
  },
};

async function runOne(job: Job): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    // Unknown type: fail it outright rather than letting it be re-claimed on
    // every tick for the rest of the process's life.
    failJob(job.id, `Sem handler para o tipo "${job.type}"`, true);
    return;
  }

  try {
    let payload: Record<string, unknown>;
    try {
      payload = job.payload ? JSON.parse(job.payload) : {};
    } catch {
      failJob(job.id, "Payload inválido (JSON malformado)", true);
      return;
    }
    const result = await handler(payload, job);
    completeJob(job.id, result ?? undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[jobs] ${job.type} (${job.id}) falhou:`, message);
    failJob(job.id, message);
  }
}

/** Drain everything currently due. Returns how many ran. */
export async function drainJobs(max = 20): Promise<number> {
  let processed = 0;
  while (processed < max) {
    const job = dequeueJob();
    if (!job) break;
    await runOne(job);
    processed++;
  }
  return processed;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startJobWorker(): void {
  if (timer) return; // Next's dev server re-runs instrumentation on reload.

  const requeued = requeueStaleJobs();
  if (requeued > 0) {
    console.log(`[jobs] ${requeued} job(s) presos em "running" devolvidos à fila`);
  }

  let running = false;
  timer = setInterval(async () => {
    // Skip the tick instead of overlapping: better-sqlite3 is synchronous and
    // the handlers are not, so two drains at once would interleave writes.
    if (running) return;
    running = true;
    try {
      await drainJobs();
    } catch (error) {
      console.error("[jobs] worker tick falhou:", error);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);

  // Do not hold the process open on shutdown.
  timer.unref?.();

  console.log("[jobs] worker iniciado");
}

export function stopJobWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
