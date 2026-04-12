import { requireAuth } from "~/lib/server/auth-utils.server";
import { syncMatches } from "~/lib/server/api-football.server";
import { logger } from "~/lib/server/logger.server";

export async function action({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    return Response.json({ error: "Non autorisé" }, { status: 403 });
  }

  try {
    const result = await syncMatches();
    return Response.json({
      success: true,
      message: `Sync terminée : ${result.created} créés, ${result.updated} mis à jour.`,
      ...result,
    });
  } catch (error) {
    logger.error({ error }, "Erreur sync API-Football");
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
