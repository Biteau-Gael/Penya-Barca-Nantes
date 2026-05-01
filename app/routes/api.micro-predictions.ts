import { db } from "~/db/client";
import { microPredictions, microPredictionAnswers } from "~/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { createId } from "~/lib/utils";
import { logger } from "~/lib/server/logger.server";

export async function action({ request }: { request: Request }) {
  const session = await requireAuth(request);
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // --- Admin : créer un micro-pronostic ---
  if (intent === "create" && session.user.role === "admin") {
    const matchId = formData.get("matchId") as string;
    const question = formData.get("question") as string;
    const ALLOWED_TYPES = ["qcm", "libre"] as const;
    const rawType = formData.get("type") as string;
    const type = ALLOWED_TYPES.includes(rawType as typeof ALLOWED_TYPES[number]) ? rawType : "qcm";
    const optionsRaw = formData.get("options") as string;
    const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
    const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;

    if (!matchId || !question) {
      return Response.json({ error: "Champs manquants" }, { status: 400 });
    }

    const options = optionsRaw ? JSON.stringify(optionsRaw.split(",").map((o) => o.trim())) : null;

    const [created] = await db.insert(microPredictions).values({
      id: createId(),
      matchId,
      question,
      type,
      options,
      pointsValue,
      deadlineSeconds,
    }).returning();

    logger.info({ microId: created.id, matchId }, "Micro-pronostic créé");
    return Response.json({ success: true, microPrediction: created });
  }

  // --- Admin : clôturer un micro-pronostic ---
  if (intent === "close" && session.user.role === "admin") {
    const microId = formData.get("microId") as string;
    const correctAnswer = formData.get("correctAnswer") as string;

    if (!microId || !correctAnswer) {
      return Response.json({ error: "Champs manquants" }, { status: 400 });
    }

    // Mettre à jour le micro-pronostic
    const [micro] = await db
      .update(microPredictions)
      .set({ correctAnswer, closedAt: new Date() })
      .where(eq(microPredictions.id, microId))
      .returning();

    if (!micro) {
      return Response.json({ error: "Micro-pronostic introuvable" }, { status: 404 });
    }

    // Attribuer les points
    const answers = await db
      .select()
      .from(microPredictionAnswers)
      .where(eq(microPredictionAnswers.microPredictionId, microId));

    let scored = 0;
    for (const answer of answers) {
      const isCorrect = answer.answer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
      const points = isCorrect ? micro.pointsValue : 0;

      await db
        .update(microPredictionAnswers)
        .set({ points })
        .where(eq(microPredictionAnswers.id, answer.id));

      if (isCorrect) scored++;
    }

    logger.info({ microId, correctAnswer, scored, total: answers.length }, "Micro-pronostic clôturé");
    return Response.json({ success: true, scored, total: answers.length });
  }

  // --- Joueur : répondre à un micro-pronostic ---
  if (intent === "answer") {
    const microId = formData.get("microId") as string;
    const answer = formData.get("answer") as string;

    if (!microId || !answer) {
      return Response.json({ error: "Champs manquants" }, { status: 400 });
    }

    // Vérifier que le micro n'est pas clôturé
    const [micro] = await db
      .select()
      .from(microPredictions)
      .where(eq(microPredictions.id, microId));

    if (!micro || micro.closedAt) {
      return Response.json({ error: "Micro-pronostic ferm��" }, { status: 400 });
    }

    // Vérifier que l'utilisateur n'a pas déjà répondu
    const [existing] = await db
      .select()
      .from(microPredictionAnswers)
      .where(
        and(
          eq(microPredictionAnswers.microPredictionId, microId),
          eq(microPredictionAnswers.userId, session.user.id),
        ),
      );

    if (existing) {
      return Response.json({ error: "Déjà répondu" }, { status: 400 });
    }

    await db.insert(microPredictionAnswers).values({
      id: createId(),
      microPredictionId: microId,
      userId: session.user.id,
      answer,
    });

    logger.info({ microId, userId: session.user.id }, "Réponse micro-pronostic");
    return Response.json({ success: true });
  }

  // --- Admin : supprimer un micro-pronostic ---
  if (intent === "delete" && session.user.role === "admin") {
    const microId = formData.get("microId") as string;
    if (!microId) {
      return Response.json({ error: "ID manquant" }, { status: 400 });
    }

    // Supprimer les réponses puis le micro-pronostic
    await db
      .delete(microPredictionAnswers)
      .where(eq(microPredictionAnswers.microPredictionId, microId));

    await db
      .delete(microPredictions)
      .where(eq(microPredictions.id, microId));

    logger.info({ microId }, "Micro-pronostic supprimé");
    return Response.json({ success: true });
  }

  return Response.json({ error: "Action inconnue" }, { status: 400 });
}
