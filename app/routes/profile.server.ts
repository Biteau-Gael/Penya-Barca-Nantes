import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { updateProfileSchema } from "~/lib/validation/user";
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { processAvatar } from "~/lib/server/upload";
import { logger } from "~/lib/server/logger.server";

export async function profileLoader({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const [userData] = await db
    .select()
    .from(user)
    .where(eq(user.id, session.user.id));

  if (!userData) throw redirect("/connexion");

  // Stats pronostics — valeurs par défaut (Epic 4 alimentera les données réelles)
  const stats = {
    totalPredictions: 0,
    totalPoints: 0,
    successRate: 0,
  };

  return {
    user: {
      id: userData.id,
      name: userData.name,
      pseudo: userData.pseudo,
      email: userData.email,
      avatarUrl: userData.avatarUrl,
      role: userData.role,
      gdprConsent: userData.gdprConsent,
      createdAt: userData.createdAt.toISOString(),
    },
    stats,
  };
}

export async function profileAction({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Suppression de compte
  if (intent === "delete-account") {
    await db.delete(user).where(eq(user.id, session.user.id));
    logger.info({ action: "account-deleted", userId: session.user.id }, "Compte supprimé");
    return { success: true, message: "Compte supprimé.", deleted: true };
  }

  // Upload avatar
  if (intent === "update-avatar") {
    const file = formData.get("avatar") as File;
    if (!file || file.size === 0) {
      return { error: "Aucun fichier sélectionné." };
    }

    try {
      const avatarUrl = await processAvatar(file, session.user.id);
      await db.update(user).set({ avatarUrl, updatedAt: new Date() }).where(eq(user.id, session.user.id));
      logger.info({ action: "profile-updated", userId: session.user.id, field: "avatar" }, "Avatar mis à jour");
      return { success: true, message: "Avatar mis à jour avec succès !" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'upload.";
      return { error: message };
    }
  }

  // Mise à jour du pseudo
  if (intent === "update-pseudo") {
    const newPseudo = formData.get("pseudo") as string;
    const result = updateProfileSchema.safeParse({ pseudo: newPseudo });

    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    // Vérifier unicité
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.pseudo, result.data.pseudo), ne(user.id, session.user.id)));

    if (existing.length > 0) {
      return { error: "Ce pseudo est déjà pris par un autre membre." };
    }

    await db
      .update(user)
      .set({ pseudo: result.data.pseudo, updatedAt: new Date() })
      .where(eq(user.id, session.user.id));

    logger.info({ action: "profile-updated", userId: session.user.id, field: "pseudo" }, "Pseudo mis à jour");
    return { success: true, message: "Pseudo mis à jour avec succès !" };
  }

  return { error: "Action inconnue." };
}
