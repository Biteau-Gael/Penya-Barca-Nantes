import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { eq } from "drizzle-orm";

export async function memberProfileLoader({
  request,
  params,
}: {
  request: Request;
  params: { memberId: string };
}) {
  try {
    await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const [member] = await db
    .select({
      id: user.id,
      name: user.name,
      pseudo: user.pseudo,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, params.memberId));

  if (!member) {
    throw new Response("Membre introuvable", { status: 404 });
  }

  // Stats pronostics — valeurs par défaut (Epic 4 alimentera les données réelles)
  const stats = {
    totalPredictions: 0,
    totalPoints: 0,
    successRate: 0,
  };

  return {
    member: {
      id: member.id,
      name: member.name,
      pseudo: member.pseudo,
      avatarUrl: member.avatarUrl,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
    stats,
  };
}
