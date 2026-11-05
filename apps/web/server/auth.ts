import { PrismaAdapter } from "@auth/prisma-adapter";
import { getConfig, getLogger, recordAudit } from "@pathfinder/core";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import NextAuth from "next-auth";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import Google from "next-auth/providers/google";
import { headers } from "next/headers";
import { ipHashFrom } from "./request-ip";

/** Session cookie lifetime. Database sessions, so signing out or deleting the account ends them at once. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function createAdapter(): Adapter {
  const base = PrismaAdapter(getPrisma() as never) as Adapter;
  return {
    ...base,
    // We only need to know who the student is. Google's access and refresh tokens are not stored.
    linkAccount(account: AdapterAccount) {
      return base.linkAccount!({
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        expires_at: undefined,
        session_state: undefined,
      });
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const config = getConfig();
  return {
    adapter: createAdapter(),
    secret: config.AUTH_SECRET,
    trustHost: true,
    session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 24 * 60 * 60 },
    providers:
      config.AUTH_GOOGLE_ID && config.AUTH_GOOGLE_SECRET
        ? [Google({ clientId: config.AUTH_GOOGLE_ID, clientSecret: config.AUTH_GOOGLE_SECRET })]
        : [],
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      async signIn({ user }) {
        // A deleted account cannot sign back in.
        return !(user as { deletedAt?: Date | null }).deletedAt;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    events: {
      async signIn({ user }) {
        if (!user.id) return;
        try {
          await recordAudit(scopedDb(user.id), "SIGN_IN", ipHashFrom(await headers()));
        } catch (error) {
          getLogger().warn({ err: (error as Error).name }, "could not write sign-in audit entry");
        }
      },
      async signOut(message) {
        // Database sessions: Auth.js passes the session row being deleted.
        const userId = "session" in message ? message.session?.userId : undefined;
        if (!userId) return;
        try {
          await recordAudit(scopedDb(userId), "SIGN_OUT", ipHashFrom(await headers()));
        } catch (error) {
          getLogger().warn({ err: (error as Error).name }, "could not write sign-out audit entry");
        }
      },
    },
  };
});
