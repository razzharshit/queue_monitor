import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "qmon_session";

export interface SessionClaims {
  sub: string;
  email: string;
  sid: string;
  demo: boolean;
  iat: number;
  exp: number;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

export function createSessionToken(
  user: { id: string; email: string; isDemo?: boolean },
  secret: string,
  sessionId: string,
  ttlSeconds = 8 * 60 * 60,
): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sub: user.id,
    email: user.email,
    sid: sessionId,
    demo: user.isDemo ?? false,
    iat: now,
    exp: now + ttlSeconds,
  } satisfies SessionClaims);
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionClaims | null {
  const [header, payload, suppliedSignature, extra] = token.split(".");
  if (!header || !payload || !suppliedSignature || extra !== undefined) return null;

  const expectedSignature = signature(`${header}.${payload}`, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as unknown;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsedHeader !== "object" ||
      parsedHeader === null ||
      (parsedHeader as { alg?: unknown }).alg !== "HS256" ||
      typeof claims !== "object" ||
      claims === null
    ) {
      return null;
    }
    const candidate = claims as Partial<SessionClaims>;
    const now = Math.floor(Date.now() / 1_000);
    if (
      typeof candidate.sub !== "string" ||
      typeof candidate.email !== "string" ||
      typeof candidate.sid !== "string" ||
      (candidate.demo !== undefined && typeof candidate.demo !== "boolean") ||
      typeof candidate.iat !== "number" ||
      typeof candidate.exp !== "number" ||
      candidate.exp <= now ||
      candidate.iat > now + 60
    ) {
      return null;
    }
    return { ...candidate, demo: candidate.demo ?? false } as SessionClaims;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values instead of rejecting unrelated requests.
    }
  }
  return cookies;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=28800",
  ]
    .filter(Boolean)
    .join("; ");
}

export function expiredSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}
