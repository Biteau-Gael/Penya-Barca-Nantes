import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { matches, matchPredictions } from "~/db/schema";
import { eq, desc } from "drizzle-orm";
import { createMatchSchema, updateMatchSchema } from "~/lib/validation/match";
import { logger } from "~/lib/server/logger.server";
import { createId } from "~/lib/utils";
import { calculatePoints } from "~/lib/points";

export async function adminMatchesLoader({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const allMatches = await db
    .select()
    .from(matches)
    .orderBy(desc(matches.matchDate));

  return {
    matches: allMatches.map((m) => ({
      ...m,
      matchDate: m.matchDate.toISOString(),
      predictionDeadline: m.predictionDeadline?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  };
}

export async function adminMatchesAction({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const raw = {
      opponent: formData.get("opponent") as string,
      competition: formData.get("competition") as string,
      matchDate: formData.get("matchDate") as string,
      venue: formData.get("venue") as string,
    };

    const result = createMatchSchema.safeParse(raw);
    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    const deadlineStr = formData.get("predictionDeadline") as string;
    const deadline = deadlineStr ? new Date(deadlineStr) : null;
    const pointsScheme = (formData.get("pointsScheme") as string) || "standard";

    if (deadline && deadline >= result.data.matchDate) {
      return { error: "La deadline des pronostics doit être avant le coup d'envoi." };
    }

    await db.insert(matches).values({
      id: createId(),
      opponent: result.data.opponent,
      competition: result.data.competition,
      matchDate: result.data.matchDate,
      venue: result.data.venue,
      predictionDeadline: deadline,
      pointsScheme,
    });

    logger.info({ action: "match-created", opponent: result.data.opponent }, "Match créé");
    return { success: true, message: "Match créé avec succès !" };
  }

  if (intent === "update") {
    const raw = {
      id: formData.get("id") as string,
      opponent: formData.get("opponent") as string,
      competition: formData.get("competition") as string,
      matchDate: formData.get("matchDate") as string,
      venue: formData.get("venue") as string,
    };

    const result = updateMatchSchema.safeParse(raw);
    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    const deadlineStr = formData.get("predictionDeadline") as string;
    const deadline = deadlineStr ? new Date(deadlineStr) : null;
    const pointsScheme = (formData.get("pointsScheme") as string) || "standard";

    if (deadline && deadline >= result.data.matchDate) {
      return { error: "La deadline des pronostics doit être avant le coup d'envoi." };
    }

    await db
      .update(matches)
      .set({
        opponent: result.data.opponent,
        competition: result.data.competition,
        matchDate: result.data.matchDate,
        venue: result.data.venue,
        predictionDeadline: deadline,
        pointsScheme,
        updatedAt: new Date(),
      })
      .where(eq(matches.id, result.data.id));

    logger.info({ action: "match-updated", matchId: result.data.id }, "Match modifié");
    return { success: true, message: "Match modifié avec succès !" };
  }

  if (intent === "set-result") {
    const id = formData.get("id") as string;
    const homeScore = parseInt(formData.get("homeScore") as string);
    const awayScore = parseInt(formData.get("awayScore") as string);

    if (!id || isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      return { error: "Score invalide." };
    }

    // Sauvegarder le résultat
    const [match] = await db.select().from(matches).where(eq(matches.id, id));
    if (!match) return { error: "Match introuvable." };

    await db
      .update(matches)
      .set({ homeScore, awayScore, updatedAt: new Date() })
      .where(eq(matches.id, id));

    // Calculer les points pour tous les pronostics
    const predictions = await db
      .select()
      .from(matchPredictions)
      .where(eq(matchPredictions.matchId, id));

    let scored = 0;
    for (const pred of predictions) {
      const points = calculatePoints(
        pred.homeScore,
        pred.awayScore,
        homeScore,
        awayScore,
        match.pointsScheme || "standard",
      );

      await db
        .update(matchPredictions)
        .set({ points, updatedAt: new Date() })
        .where(eq(matchPredictions.id, pred.id));

      scored++;
    }

    logger.info({ action: "match-result-set", matchId: id, scored }, "Résultat saisi et points calculés");
    return { success: true, message: `Résultat enregistré ! ${scored} pronostics calculés.` };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    if (!id) return { error: "ID manquant." };

    await db.delete(matches).where(eq(matches.id, id));

    logger.info({ action: "match-deleted", matchId: id }, "Match supprimé");
    return { success: true, message: "Match supprimé." };
  }

  return { error: "Action inconnue." };
}
