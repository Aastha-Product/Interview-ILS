// Pathfinder: what the sign-in pages say when Firebase Authentication refuses something.

/** The shortest password we accept; Firebase itself only asks for 6 characters. */
export const MIN_PASSWORD = 8;

/** What to tell the student for a Firebase error; null when there's nothing to say (they closed the window). */
export function firebaseErrorMessage(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return null;
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password don't match. Try again, or reset your password.";
    case "auth/email-already-in-use":
      return "There's already an account with this email address. Sign in instead.";
    case "auth/weak-password":
      return `Choose a password of at least ${MIN_PASSWORD} characters.`;
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been turned off. Contact support if you think that's a mistake.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes, then try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google window. Allow pop-ups for this site and try again.";
    case "auth/account-exists-with-different-credential":
      return "This email address already has an account with a password. Sign in with your password.";
    case "auth/network-request-failed":
      return "You seem to be offline. Try again when you're connected.";
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
    case "auth/unauthorized-domain":
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "Sign-in isn't fully set up on this server yet.";
    default:
      return "Something went wrong. Try again.";
  }
}
