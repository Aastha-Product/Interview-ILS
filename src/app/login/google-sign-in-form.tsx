import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SIGN_IN_ERRORS, SIGN_IN_PATH, type SignInError } from "@/lib/auth/google-sign-in";

/**
 * Signing in with Google (Pathfinder). A plain form, so it works before scripts have run: it
 * goes to /api/auth/google, which sends the browser on to Google. `error` is what came back
 * from a sign-in that didn't work.
 */
export function GoogleSignInForm({ next, error }: { next?: string; error?: string }) {
  const message = error && error in SIGN_IN_ERRORS ? SIGN_IN_ERRORS[error as SignInError] : null;
  return (
    <form method="get" action={SIGN_IN_PATH} className="flex flex-col gap-5">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Welcome</h1>
        <p className="text-sm text-muted">Sign in with your Google account to pick up where you left off, or to start.</p>
      </div>

      {message && (
        <p role="alert" className="text-meta text-error">
          {message}
        </p>
      )}

      <Checkbox label="Keep me signed in for 30 days" name="remember" />

      <Button type="submit" size="lg">
        Continue with Google
      </Button>
    </form>
  );
}
