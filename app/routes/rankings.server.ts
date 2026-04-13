import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { matchPredictions, user, matches, seasons } from "~/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { getOrCreateActiveSeason, getAllSeasons } from "~/lib/server/seasons.server";

export async function rankingsLoader({
  request,
}: {
  request: Request;
  params: { seasonId?: string };
}) {
  try {
    await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const url = new URL(request.url);
  const seasonParam = url.searchParams.get("saison");

  // Déterminer la saison à afficher
  const activeSeason = await getOrCreateActiveSeason();
  const allSeasons = await getAllSeasons();
  const seasonLabel = seasonParam || activeSeason.label;

  const rankings = await db
    .select({
      userId: matchPredictions.userId,
      pseudo: user.pseudo,
      name: user.name,
      avatarUrl: user.avatarUrl,
      currentStreak: user.currentStreak,
      bestStreak: user.bestStreak,
      totalPoints: sql<number>`COALESCE(SUM(${matchPredictions.points}), 0)`.as("total_points"),
      totalPredictions: sql<number>`COUNT(${matchPredictions.id})`.as("total_predictions"),
      exactScores: sql<number>`COUNT(CASE WHEN ${matchPredictions.points} >= 3 THEN 1 END)`.as("exact_scores"),
    })
    .from(matchPredictions)
    .innerJoin(user, eq(matchPredictions.userId, user.id))
    .innerJoin(matches, eq(matchPredictions.matchId, matches.id))
    .where(eq(matches.season, seasonLabel))
    .groupBy(matchPredictions.userId, user.pseudo, user.name, user.avatarUrl, user.currentStreak, user.bestStreak)
    .orderBy(desc(sql`total_points`));

  return {
    rankings: rankings.map((r, i) => ({
      position: i + 1,
      pseudo: r.pseudo || r.name,
      avatarUrl: r.avatarUrl,
      totalPoints: Number(r.totalPoints),
      totalPredictions: Number(r.totalPredictions),
      exactScores: Number(r.exactScores),
      currentStreak: r.currentStreak,
      bestStreak: r.bestStreak,
    })),
    currentSeason: seasonLabel,
    activeSeason: activeSeason.label,
    seasons: allSeasons.map((s) => ({ label: s.label, isActive: s.isActive })),
  };
}
