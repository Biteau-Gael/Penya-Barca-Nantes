import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user, matchPredictions, matches } from "~/db/schema";
import { eq, sql, desc } from "drizzle-orm";

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

  // Stats pronostics réelles
  const [statsRow] = await db
    .select({
      totalPredictions: sql<number>`count(*)::int`,
      totalPoints: sql<number>`coalesce(sum(${matchPredictions.points}), 0)::int`,
      scoredCount: sql<number>`count(${matchPredictions.points})::int`,
      correctCount: sql<number>`count(case when ${matchPredictions.points} > 0 then 1 end)::int`,
    })
    .from(matchPredictions)
    .where(eq(matchPredictions.userId, params.memberId));

  const stats = {
    totalPredictions: statsRow?.totalPredictions ?? 0,
    totalPoints: statsRow?.totalPoints ?? 0,
    successRate: statsRow && statsRow.scoredCount > 0
      ? Math.round((statsRow.correctCount / statsRow.scoredCount) * 100)
      : 0,
  };

  // Historique des pronostics
  const predictions = await db
    .select({
      predHomeScore: matchPredictions.homeScore,
      predAwayScore: matchPredictions.awayScore,
      points: matchPredictions.points,
      matchId: matches.id,
      opponent: matches.opponent,
      competition: matches.competition,
      matchDate: matches.matchDate,
      venue: matches.venue,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      opponentLogo: matches.opponentLogo,
    })
    .from(matchPredictions)
    .innerJoin(matches, eq(matchPredictions.matchId, matches.id))
    .where(eq(matchPredictions.userId, params.memberId))
    .orderBy(desc(matches.matchDate));

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
    predictions: predictions.map((p) => ({
      matchId: p.matchId,
      opponent: p.opponent,
      competition: p.competition,
      matchDate: p.matchDate.toISOString(),
      venue: p.venue,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      predHomeScore: p.predHomeScore,
      predAwayScore: p.predAwayScore,
      points: p.points,
      opponentLogo: p.opponentLogo,
    })),
  };
}
