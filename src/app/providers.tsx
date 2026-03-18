"use client";

import { SessionProvider } from "next-auth/react";
import { DeckStreamProvider } from "@/contexts/deck-stream-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DeckStreamProvider>{children}</DeckStreamProvider>
    </SessionProvider>
  );
}
