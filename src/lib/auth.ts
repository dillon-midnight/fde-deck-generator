import { NextAuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // prompt: "consent" forces Google to show the OAuth consent screen on every
      // login and guarantees a refresh token is issued each time. Without this,
      // Google only issues a refresh token on the *first* consent — subsequent
      // logins return only an access token. If the refresh token is lost (user
      // clears cookies, token revoked, server restarts) silent re-auth fails and
      // the user gets a RefreshAccessTokenError with no recovery path. The UX
      // cost (an extra click) is worth the reliability guarantee.
      //
      // access_type: "offline" is required for the refresh token to be issued at
      // all. Together these two params are the pattern for durable Google OAuth
      // sessions in server-side Next.js apps.
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/drive.file",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign-in
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: (account.expires_at ?? 0) * 1000,
        };
      }

      // Short-circuit: return the cached token if it hasn't expired yet.
      // Without this check every API route would trigger a Google token refresh
      // request on every call, adding ~200ms of latency and burning refresh token
      // quota. Access tokens are valid for 1 hour; this check avoids unnecessary
      // round-trips during that window.
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Refresh expired token
      try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refreshToken as string,
          }),
        });
        const refreshed = await res.json();
        if (!res.ok) throw refreshed;
        return {
          ...token,
          accessToken: refreshed.access_token,
          accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
        };
      } catch {
        return { ...token, error: "RefreshAccessTokenError" };
      }
    },
    async session({ session, token }) {
      (session as unknown as Record<string, unknown>).accessToken = token.accessToken;
      (session as unknown as Record<string, unknown>).error = token.error;
      if (token.sub) {
        session.user = { ...session.user, id: token.sub };
      }
      return session;
    },
  },
};

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}
