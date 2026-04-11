import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { eq } from "drizzle-orm";

export async function action({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    return new Response("Non authentifié", { status: 401 });
  }

  await db
    .update(user)
    .set({ welcomeShown: true, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
