import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { desc } from "drizzle-orm";

export async function membersListLoader({ request }: { request: Request }) {
  try {
    await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const members = await db
    .select({
      id: user.id,
      name: user.name,
      pseudo: user.pseudo,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));

  return {
    members: members.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
