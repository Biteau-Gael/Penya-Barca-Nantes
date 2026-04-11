import { db } from "~/db/client";
import { matches } from "~/db/schema";
import { asc } from "drizzle-orm";

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

  return { upcoming, past };
}
