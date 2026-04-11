import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { matchPredictions, user } from "~/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export async function rankingsLoader({ request }: { request: Request }) {
  try {
    await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const rankings = await db
    .select({
      userId: matchPredictions.userId,
      pseudo: user.pseudo,
      name: user.name,
      avatarUrl: user.avatarUrl,
      totalPoints: sql<number>`COALESCE(SUM(${matchPredictions.points}), 0)`.as("total_points"),
      totalPredictions: sql<number>`COUNT(${matchPredictions.id})`.as("total_predictions"),
    })
    .from(matchPredictions)
    .innerJoin(user, eq(matchPredictions.userId, user.id))
    .groupBy(matchPredictions.userId, user.pseudo, user.name, user.avatarUrl)
    .orderBy(desc(sql`total_points`));

  return {
    rankings: rankings.map((r, i) => ({
      position: i + 1,
      pseudo: r.pseudo || r.name,
      avatarUrl: r.avatarUrl,
      totalPoints: Number(r.totalPoints),
      totalPredictions: Number(r.totalPredictions),
    })),
  };
}
