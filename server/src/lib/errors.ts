import type { Context } from "hono";

export function jsonError(c: Context, status: number, message: string) {
  return c.json({ error: message }, status as any);
}

export function notFound(c: Context, resource = "Resource") {
  return jsonError(c, 404, `${resource} not found`);
}

export function forbidden(c: Context) {
  return jsonError(c, 403, "Forbidden");
}

export function badRequest(c: Context, message: string) {
  return jsonError(c, 400, message);
}

export function internalError(c: Context) {
  return jsonError(c, 500, "Internal server error");
}
