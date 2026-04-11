import { db } from "~/db/client";
import { matches, matchPredictions, user } from "~/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession } from "~/lib/server/auth-utils.server";
import { predictionSchema } from "~/lib/validation/prediction";
import { logger } from "~/lib/server/logger.server";
import { createId } from "~/lib/utils";

export async function matchDetailLoader({
  request,
  params,
}: {
  request: Request;
  params: { matchId: string };
}) {
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, params.matchId));

  if (!match) {
    throw new Response("Match introuvable", { status: 404 });
  }

  // Charger le pronostic du user si connecté
  const session = await getSession(request);
  let userPrediction = null;

  if (session?.user) {
    const [pred] = await db
      .select()
      .from(matchPredictions)
      .where(
        and(
          eq(matchPredictions.matchId, params.matchId),
          eq(matchPredictions.userId, session.user.id),
        ),
      );
    if (pred) {
      userPrediction = {
        homeScore: pred.homeScore,
        awayScore: pred.awayScore,
        points: pred.points,
      };
    }
  }

  // Charger les pronos des autres membres (visibles après deadline)
  let otherPredictions: { pseudo: string; homeScore: number; awayScore: number; points: number | null }[] = [];
  const deadlinePassed = match.predictionDeadline && new Date() > match.predictionDeadline;

  if (deadlinePassed && session?.user) {
    const allPreds = await db
      .select({
        pseudo: user.pseudo,
        name: user.name,
        homeScore: matchPredictions.homeScore,
        awayScore: matchPredictions.awayScore,
        points: matchPredictions.points,
        userId: matchPredictions.userId,
      })
      .from(matchPredictions)
      .innerJoin(user, eq(matchPredictions.userId, user.id))
      .where(eq(matchPredictions.matchId, params.matchId));

    otherPredictions = allPreds.map((p) => ({
      pseudo: p.pseudo || p.name,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      points: p.points,
    }));
  }

  return {
    match: {
      ...match,
      matchDate: match.matchDate.toISOString(),
      predictionDeadline: match.predictionDeadline?.toISOString() ?? null,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
    },
    userPrediction,
    otherPredictions,
    isLoggedIn: !!session?.user,
  };
}

export async function matchDetailAction({
  request,
  params,
}: {
  request: Request;
  params: { matchId: string };
}) {
  const session = await getSession(request);
  if (!session?.user) {
    return { error: "Vous devez être connecté pour pronostiquer." };
  }

  const formData = await request.formData();
  const raw = {
    matchId: params.matchId,
    homeScore: formData.get("homeScore") as string,
    awayScore: formData.get("awayScore") as string,
  };

  const result = predictionSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  // Vérifier la deadline
  const [match] = await db
    .select({ predictionDeadline: matches.predictionDeadline })
    .from(matches)
    .where(eq(matches.id, params.matchId));

  if (!match?.predictionDeadline) {
    return { error: "Les pronostics ne sont pas encore ouverts pour ce match." };
  }

  if (new Date() > match.predictionDeadline) {
    return { error: "Deadline dépassée ! Les pronostics sont fermés." };
  }

  // Upsert : créer ou modifier
  const [existing] = await db
    .select({ id: matchPredictions.id })
    .from(matchPredictions)
    .where(
      and(
        eq(matchPredictions.matchId, params.matchId),
        eq(matchPredictions.userId, session.user.id),
      ),
    );

  if (existing) {
    await db
      .update(matchPredictions)
      .set({
        homeScore: result.data.homeScore,
        awayScore: result.data.awayScore,
        updatedAt: new Date(),
      })
      .where(eq(matchPredictions.id, existing.id));

    logger.info({ action: "prediction-updated", userId: session.user.id, matchId: params.matchId }, "Pronostic modifié");
    return { success: true, message: "Pronostic modifié avec succès !" };
  }

  await db.insert(matchPredictions).values({
    id: createId(),
    userId: session.user.id,
    matchId: params.matchId,
    homeScore: result.data.homeScore,
    awayScore: result.data.awayScore,
  });

  logger.info({ action: "prediction-submitted", userId: session.user.id, matchId: params.matchId }, "Pronostic soumis");
  return { success: true, message: "Pronostic enregistré avec succès !" };
}
