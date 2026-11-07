// The Content-Security-Policy every page gets (E11-5), set by the proxy with
// a fresh nonce per request. Next.js reads the nonce from the request's copy
// of the header and puts it on its own scripts, so pages have to render per
// request (the root layout waits for the connection).

/** 128 random bits, base64. */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * Scripts only with this request's nonce ('strict-dynamic' lets them load the
 * rest); styles may be inline, since React renders style attributes, which a
 * nonce can't cover. Nothing loads from other hosts, and no other site may
 * frame Dossier. `upgrade-insecure-requests` only over HTTPS, so a server on
 * plain HTTP in a home network keeps working. Development needs eval for
 * React's error overlay.
 *
 * Pathfinder: the sign-in form goes to /api/auth/google, which redirects on to Google, and
 * browsers hold that redirect to form-action too. So Google's sign-in host is a form target
 * (`formTargets`; the end-to-end tests add their fake Google).
 */
export const GOOGLE_SIGN_IN_ORIGIN = "https://accounts.google.com";

/**
 * Pathfinder, Firebase Authentication: the browser calls Firebase's sign-in APIs (or the local
 * emulator), and Google sign-in runs through a hidden frame on the project's auth domain.
 */
export const FIREBASE_API_ORIGINS = ["https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"];

export function firebaseSources(config: { authDomain: string; emulatorUrl: string | null } | null): { connect: string[]; frame: string[] } {
  if (!config) return { connect: [], frame: [] };
  if (config.emulatorUrl) return { connect: [config.emulatorUrl], frame: [config.emulatorUrl] };
  return { connect: FIREBASE_API_ORIGINS, frame: [`https://${config.authDomain}`] };
}

export function contentSecurityPolicy(
  nonce: string,
  {
    dev = false,
    https = false,
    formTargets = [GOOGLE_SIGN_IN_ORIGIN],
    connectTargets = [],
    frameTargets = [],
  }: { dev?: boolean; https?: boolean; formTargets?: string[]; connectTargets?: string[]; frameTargets?: string[] } = {},
): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    ["connect-src 'self'", ...connectTargets].join(" "),
    ...(frameTargets.length > 0 ? [["frame-src 'self'", ...frameTargets].join(" ")] : []),
    "object-src 'none'",
    "base-uri 'self'",
    ["form-action 'self'", ...formTargets].join(" "),
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
