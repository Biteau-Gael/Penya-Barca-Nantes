import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "~/lib/server/logger.server";

export async function adminMembersLoader({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const members = await db
    .select({
      id: user.id,
      name: user.name,
      pseudo: user.pseudo,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));

  return {
    members: members.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function adminMembersAction({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const memberId = formData.get("memberId") as string;

  if (!memberId) return { error: "ID membre manquant." };

  // Protection : un admin ne peut pas modifier son propre rôle
  if (intent === "change-role" && memberId === session.user.id) {
    return { error: "Vous ne pouvez pas modifier votre propre rôle." };
  }

  if (intent === "change-role") {
    const newRole = formData.get("role") as string;
    if (!["member", "admin", "partner"].includes(newRole)) {
      return { error: "Rôle invalide." };
    }

    await db.update(user).set({ role: newRole, updatedAt: new Date() }).where(eq(user.id, memberId));
    logger.info({ action: "role-changed", memberId, newRole, by: session.user.id }, "Rôle modifié");
    return { success: true, message: `Rôle mis à jour en "${newRole}".` };
  }

  if (intent === "delete-member") {
    if (memberId === session.user.id) {
      return { error: "Vous ne pouvez pas supprimer votre propre compte depuis l'admin." };
    }

    await db.delete(user).where(eq(user.id, memberId));
    logger.info({ action: "member-deleted", memberId, by: session.user.id }, "Membre supprimé");
    return { success: true, message: "Membre supprimé." };
  }

  return { error: "Action inconnue." };
}
