import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "brecontas-jobs-"));
const dbPath = join(dir, "test.db");

let queue: typeof import("./queue");
let sqlite: import("better-sqlite3").Database;

const USER = "user_test";

beforeAll(async () => {
  process.env.DATABASE_PATH = dbPath;

  const Database = (await import("better-sqlite3")).default;
  sqlite = new Database(dbPath);
  sqlite.exec(readFileSync(join(process.cwd(), "test-data", "schema.sql"), "utf-8"));
  sqlite
    .prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)")
    .run(USER, "Teste", "teste@brecontas.local", "scrypt$1$00$00", Math.floor(Date.now() / 1000));

  queue = await import("./queue");
});

afterAll(() => {
  sqlite?.close();
  rmSync(dir, { recursive: true, force: true });
});

const row = (id: string) =>
  sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as {
    status: string;
    attempts: number;
    scheduled_at: number;
    started_at: number | null;
    error: string | null;
  };

describe("fila de jobs", () => {
  it("claims a job exactly once", async () => {
    const id = await queue.enqueueJob("ai_classify_batch", { transactionIds: [] }, USER);

    const first = queue.dequeueJob();
    const second = queue.dequeueJob();

    expect(first?.id).toBe(id);
    expect(second).toBeNull(); // já reivindicado
    expect(row(id).status).toBe("running");
    expect(row(id).attempts).toBe(1);

    queue.completeJob(id);
    expect(row(id).status).toBe("completed");
  });

  // Returning the job straight to "pending" made the worker re-claim it on the
  // very next tick, burning all three attempts within seconds.
  it("delays the retry instead of retrying immediately", async () => {
    const id = await queue.enqueueJob("ai_classify_batch", { transactionIds: [] }, USER);
    queue.dequeueJob();

    const before = Math.floor(Date.now() / 1000);
    queue.failJob(id, "provedor indisponível");

    const after = row(id);
    expect(after.status).toBe("pending");
    expect(after.scheduled_at).toBeGreaterThan(before);
    // Not due yet, so it must not come back on the next poll.
    expect(queue.dequeueJob()).toBeNull();
  });

  it("gives up after maxAttempts and keeps the error", async () => {
    const id = await queue.enqueueJob("ai_classify_batch", { transactionIds: [] }, USER);

    for (let i = 0; i < 3; i++) {
      sqlite.prepare("UPDATE jobs SET status = 'pending', scheduled_at = 0 WHERE id = ?").run(id);
      const claimed = queue.dequeueJob();
      expect(claimed?.id).toBe(id);
      queue.failJob(id, `falha ${i + 1}`);
    }

    expect(row(id).status).toBe("failed");
    expect(row(id).error).toBe("falha 3");
  });

  // A job that was mid-flight when the container restarted used to stay
  // "running" forever, because nothing ever looked at the queue again.
  it("requeues a job left running by a dead process", async () => {
    const id = await queue.enqueueJob("ai_classify_batch", { transactionIds: [] }, USER);
    queue.dequeueJob();
    sqlite
      .prepare("UPDATE jobs SET started_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 3600, id);

    expect(queue.requeueStaleJobs()).toBe(1);
    expect(row(id).status).toBe("pending");
    expect(row(id).started_at).toBeNull();
  });
});

describe("falhas permanentes", () => {
  // An unknown job type or a malformed payload will not start working on the
  // second attempt; retrying only delays the moment the row reads "failed".
  it("does not retry a failure marked permanent", async () => {
    // The queue is FIFO by scheduled_at, so leftovers from earlier tests would
    // be claimed instead of this one.
    sqlite.prepare("DELETE FROM jobs").run();

    const id = await queue.enqueueJob("ocr_extract", {}, USER);
    expect(queue.dequeueJob()?.id).toBe(id);

    queue.failJob(id, 'Sem handler para o tipo "ocr_extract"', true);

    expect(row(id).status).toBe("failed");
    expect(row(id).attempts).toBe(1);
  });
});
