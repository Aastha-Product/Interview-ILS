/**
 * The Content-Security-Policy for every page. Scripts run only with this request's nonce (Next.js
 * adds it to its own scripts), so injected markup can't run code even if it slips past React.
 *
 * - style-src allows inline styles: a few components set widths and heights with style={...},
 *   and Radix positions popovers that way. Style injection can't run code.
 * - form-action includes Google because the sign-in form's response redirects there, and Chrome
 *   checks form-action on redirects.
 * - Development needs 'unsafe-eval' (React's debugging) and websockets (hot reload).
 */
export function buildCsp(options: { nonce: string; isDev: boolean; https: boolean }): string {
  const { nonce, isDev, https } = options;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
