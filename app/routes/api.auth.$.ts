import { auth } from "~/lib/server/auth.server";
import { checkRateLimit } from "~/lib/server/rate-limit.server";
import { logger } from "~/lib/server/logger.server";

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function applyRateLimit(request: Request) {
  const url = new URL(request.url);
  const isSignIn = url.pathname.includes("sign-in");
  const isSignUp = url.pathname.includes("sign-up");

  if (isSignIn || isSignUp) {
    const ip = getClientIp(request);
    const key = isSignIn ? `login:${ip}` : `register:${ip}`;
    const maxAttempts = isSignIn ? 10 : 5;
    const windowSeconds = isSignIn ? 900 : 3600;

    try {
      await checkRateLimit({ key, maxAttempts, windowSeconds });
    } catch {
      logger.warn({ ip, action: isSignIn ? "login-rate-limited" : "register-rate-limited" }, "Rate limit exceeded");
      return new Response(
        JSON.stringify({ error: { code: "RATE_LIMIT_EXCEEDED", message: "Trop de tentatives. Veuillez réessayer plus tard." } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  return null;
}

export async function loader({ request }: { request: Request }) {
  return auth.handler(request);
}

export async function action({ request }: { request: Request }) {
  const rateLimitResponse = await applyRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;
  return auth.handler(request);
}
