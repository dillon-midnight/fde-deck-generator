// Suspense fallback for the dashboard route. Next.js automatically wraps
// the page in a <Suspense> boundary using this file. The skeleton streams
// to the browser immediately on navigation while the server fetches deals
// from the database — the user sees structure instead of a blank screen.
export default function DashboardLoading() {
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
        <div className="flex items-center justify-between mb-6">
          <div className="h-7 w-32 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
          <div className="h-9 w-24 bg-neutral-200 dark:bg-neutral-800 rounded-lg animate-pulse" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="p-4 border border-neutral-200 dark:border-neutral-800 rounded-lg"
            >
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-5 w-40 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
                  <div className="h-4 w-28 bg-neutral-100 dark:bg-neutral-800/60 rounded animate-pulse" />
                </div>
                <div className="h-6 w-24 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
