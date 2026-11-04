/** Browser-side helper for our JSON API. Errors carry the friendly message the server chose. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers:
        init.body instanceof FormData
          ? init.headers
          : { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiRequestError(0, "OFFLINE", "We couldn't reach Pathfinder. Check your internet connection and try again.");
  }
  if (response.status === 401) {
    // A full page load (not client navigation) so no stale signed-in state survives.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/signin");
    throw new ApiRequestError(401, "SIGNED_OUT", "Please sign in again.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? "SERVER_ERROR",
      error?.message ?? "Something went wrong. Please try again.",
      error?.fields ?? [],
    );
  }
  return body as T;
}
