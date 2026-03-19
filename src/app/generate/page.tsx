// RENDERING STRATEGY: Server Component with Client Component islands.
// The page shell (nav, heading, layout) is server-rendered with zero JS
// bundle cost. SignalForm is a Client Component "island" because it manages
// form state, uses useDeckStreamContext() for streaming, and triggers
// client-side navigation. This is the Next.js composition model — push
// "use client" to the leaves, keep the trunk server-rendered.
import { Nav } from "@/components/nav";
import { SignalForm } from "@/components/signal-form";

export default function GeneratePage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Generate a Deck</h1>
        <SignalForm />
      </main>
    </div>
  );
}
