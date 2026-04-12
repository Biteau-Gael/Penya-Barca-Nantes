import { db } from "~/db/client";
import { matches } from "~/db/schema";
import { asc } from "drizzle-orm";

export type FormResult = "V" | "N" | "D";

function getResult(m: { venue: string; homeScore: number | null; awayScore: number | null }): FormResult | null {
  if (m.homeScore === null || m.awayScore === null) return null;
  const barcaGoals = m.venue === "home" ? m.homeScore : m.awayScore;
  const opponentGoals = m.venue === "home" ? m.awayScore : m.homeScore;
  if (barcaGoals > opponentGoals) return "V";
  if (barcaGoals < opponentGoals) return "D";
  return "N";
}

export async function calendarLoader() {
  const allMatches = await db
    .select()
    .from(matches)
    .orderBy(asc(matches.matchDate));

  const now = new Date();

  const upcoming = allMatches
    .filter((m) => m.matchDate >= now)
    .map((m) => ({
      ...m,
      matchDate: m.matchDate.toISOString(),
      predictionDeadline: m.predictionDeadline?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));

  const past = allMatches
    .filter((m) => m.matchDate < now)
    .reverse()
    .map((m) => ({
      ...m,
      matchDate: m.matchDate.toISOString(),
      predictionDeadline: m.predictionDeadline?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));

  // Forme récente : 5 derniers résultats du Barça
  const recentForm: FormResult[] = allMatches
    .filter((m) => m.matchDate < now && m.homeScore !== null)
    .reverse()
    .slice(0, 5)
    .map((m) => getResult(m)!)
    .filter(Boolean);

  return { upcoming, past, recentForm };
}
