// RENDERING STRATEGY: Server Component with server-side redirect.
// The login page is static markup — heading, description, and a sign-in
// button. Making it a Server Component means zero JS ships for the shell.
// The auth check and redirect happen server-side via getServerSession(),
// so authenticated users never see the login page flash. The only Client
// Component is SignInButton, because next-auth's signIn() is a
// browser-side function that opens the OAuth popup.
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "@/components/sign-in-button";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-lg p-8 max-w-sm w-full text-center space-y-6">
        <h1 className="text-2xl font-bold">SA Deck Generator</h1>
        <p className="text-foreground/60 text-sm">
          Generate grounded technical solution decks from discovery signals.
        </p>
        <SignInButton />
      </div>
    </div>
  );
}
