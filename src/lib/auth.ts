import { NextAuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Only basic profile scopes are requested. Drive/Slides scopes were
      // removed because Google's OAuth app verification process (required for
      // sensitive scopes) takes weeks and blocks deployment. PPTX export is
      // now handled client-side via pptxgenjs, so no Google API tokens are
      // needed beyond sign-in.
      authorization: {
        params: {
          scope: "openid email profile",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token }) {
      return token;
    },
    async session({ session, token }) {
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
