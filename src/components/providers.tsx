"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import superjson from "superjson";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MonthProvider } from "@/hooks/use-month";
import { UndoRedoProvider } from "@/hooks/use-undo-redo";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return "http://localhost:3000";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 1000 } },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MonthProvider>
              <UndoRedoProvider>
                {children}
              </UndoRedoProvider>
            </MonthProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
}
