// Suspense fallback for the deck route. Even though the page is a Client
// Component, loading.tsx still helps — it streams a skeleton to the browser
// instantly during navigation instead of showing a blank screen while the
// client JS bundle downloads and hydrates. This is Suspense working with
// CSR, not replacing it.
export default function DeckLoading() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="h-5 w-36 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
          <div className="flex items-center gap-6">
            <div className="h-4 w-20 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
            <div className="h-4 w-20 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
          </div>
          <div className="h-8 w-8 bg-neutral-200 dark:bg-neutral-800 rounded-full animate-pulse" />
        </div>
      </div>
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-6">
          <div className="h-8 w-64 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
          <div className="space-y-4">
            <div className="h-48 bg-neutral-200 dark:bg-neutral-800 rounded-lg animate-pulse" />
            <div className="h-48 bg-neutral-200 dark:bg-neutral-800 rounded-lg animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
