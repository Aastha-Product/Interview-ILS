import "server-only";
import { getConfig, getLogger, UserFacingError } from "@pathfinder/core";
import { scopedDb, ScopeViolationError, type ScopedDb } from "@pathfinder/db";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type CurrentUser } from "./session";

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Array<{ path: string; message: string }> };
}

export function apiError(status: number, code: string, message: string, extra?: Partial<ApiErrorBody["error"]>) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message, ...extra } }, { status });
}

type Handler<C> = (ctx: { request: Request; user: CurrentUser; db: ScopedDb; params: C }) => Promise<Response>;

/**
 * Wraps an API route: requires a signed-in user, hands over their scoped database, and turns
 * errors into friendly JSON. Internal error details are logged without personal data, never returned.
 */
export function withUser<C = unknown>(handler: Handler<C>) {
  return async (request: Request, context: { params: Promise<C> }) => {
    const log = getLogger().child({ route: new URL(request.url).pathname, method: request.method });
    const user = await getCurrentUser();
    if (!user) return apiError(401, "SIGNED_OUT", "Please sign in again.");
    try {
      return await handler({ request, user, db: scopedDb(user.id), params: await context.params });
    } catch (error) {
      if (error instanceof UserFacingError) {
        const response = apiError(error.status, error.code, error.message);
        if (error.retryAfterSeconds !== undefined) response.headers.set("Retry-After", String(error.retryAfterSeconds));
        return response;
      }
      if (error instanceof ZodError) {
        return apiError(400, "INVALID_INPUT", "Some fields need fixing.", {
          fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      if (error instanceof ScopeViolationError) {
        log.error({ err: error.name }, "scope violation");
        return apiError(403, "FORBIDDEN", "You can't do that.");
      }
      const err = error as Error & { code?: string };
      log.error(
        getConfig().NODE_ENV === "production"
          ? { errName: err.name, errCode: err.code }
          : { errName: err.name, errCode: err.code, stack: err.stack },
        "unhandled API error",
      );
      return apiError(500, "SERVER_ERROR", "Something went wrong on our side. Please try again.");
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserFacingError("INVALID_JSON", "We couldn't read that request.");
  }
}
