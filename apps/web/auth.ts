import { verify } from "@node-rs/argon2";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const credentialsSchema = z.object({ username: z.string(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const result = credentialsSchema.safeParse(rawCredentials);
        if (!result.success || result.data.username !== (process.env.ADMIN_USERNAME ?? "admin")) return null;
        if (!process.env.ADMIN_PASSWORD_HASH) return null;
        const valid = await verify(process.env.ADMIN_PASSWORD_HASH, result.data.password);
        return valid ? { id: "admin", name: "Piano administrator", role: "admin" } : null;
      },
    }),
  ],
  callbacks: {
    authorized: async ({ auth: session }) => Boolean(session),
    jwt: async ({ token, user }) => ({ ...token, ...(user ? { role: "admin" } : {}) }),
    session: async ({ session, token }) => ({ ...session, user: { ...session.user, role: token.role as string } }),
  },
});
