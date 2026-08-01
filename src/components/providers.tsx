"use client";

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import superjson from "superjson";
import { toast } from "sonner";
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
        // With no save button, a mutation failing silently makes the user
        // believe the action was applied. Mutations with their own onError keep
        // working: this handler runs in addition to the local one, not instead.
        mutationCache: new MutationCache({
          onError: (error) => {
            toast.error("Não foi possível salvar", {
              description:
                error instanceof Error ? error.message : "Tente novamente.",
            });
          },
        }),
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
