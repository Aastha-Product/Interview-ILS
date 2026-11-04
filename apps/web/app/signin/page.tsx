import { getConfig, isDevSignInEnabled } from "@pathfinder/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { signIn } from "@/server/auth";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  const config = getConfig();
  const googleEnabled = Boolean(config.AUTH_GOOGLE_ID && config.AUTH_GOOGLE_SECRET);
  const devEnabled = isDevSignInEnabled(config);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="mb-1 text-center text-3xl font-bold text-brand-700">Pathfinder</h1>
        <p className="mb-8 text-center text-slate-600">Apply smarter: a resume tailored to each job, from your own profile.</p>
        <Card className="flex flex-col gap-5">
          {error && (
            <Alert tone="error">
              {error === "dev-email" ? "Enter a valid email address." : "We couldn't sign you in. Please try again."}
            </Alert>
          )}

          {googleEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <Button type="submit" size="lg" className="w-full">
                Continue with Google
              </Button>
            </form>
          )}

          {!googleEnabled && !devEnabled && (
            <Alert tone="error">Sign-in is not set up yet. Ask the person running Pathfinder to configure Google sign-in.</Alert>
          )}

          {devEnabled && (
            <form action="/api/dev/sign-in" method="post" className="flex flex-col gap-3 rounded-md border border-dashed border-amber-400 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">Developer sign-in (local only)</p>
              <p className="text-xs text-amber-800">
                Shown because Google sign-in isn&apos;t configured and this isn&apos;t a production build. Any email works; it creates a test account.
              </p>
              <Label htmlFor="dev-email">Email</Label>
              <Input id="dev-email" name="email" type="email" required defaultValue="student@example.test" />
              <Button type="submit" variant="outline">
                Dev sign-in
              </Button>
            </form>
          )}

          <p className="text-xs leading-relaxed text-slate-500">
            We use your name and email from Google to create your account, and the resume and profile you add to draft your
            applications. Pathfinder never logs in to job sites or applies for you. See our{" "}
            <Link href="/privacy" className="underline">
              privacy notice
            </Link>
            .
          </p>
        </Card>
      </div>
    </main>
  );
}
