import { auth } from "./auth.server";

export type Role = "member" | "admin" | "partner";

export async function getSession(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  return session;
}

export async function requireAuth(request: Request, allowedRoles?: Role[]) {
  const session = await getSession(request);

  if (!session) {
    throw new Response("Non authentifié", { status: 401 });
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role as Role)) {
    throw new Response("Accès refusé", { status: 403 });
  }

  return session;
}
