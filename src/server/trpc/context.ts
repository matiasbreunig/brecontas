import { auth } from "@/server/auth";
import { db } from "@/server/db";

export async function createContext() {
  const session = await auth();

  return {
    db,
    session,
    userId: session?.user?.id ?? null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
