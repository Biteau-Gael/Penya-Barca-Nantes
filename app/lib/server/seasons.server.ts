import { db } from "~/db/client";
import { seasons, matches } from "~/db/schema";
import { eq, sql, isNull } from "drizzle-orm";
import { createId } from "~/lib/utils";
import { logger } from "./logger.server";

const CURRENT_SEASON_LABEL = "2025-2026";

/** Retourne la saison active, ou la crée si elle n'existe pas */
export async function getOrCreateActiveSeason() {
  const [active] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isActive, true));

  if (active) return active;

  // Créer la saison courante
  const [created] = await db
    .insert(seasons)
    .values({
      id: createId(),
      label: CURRENT_SEASON_LABEL,
      startDate: new Date("2025-08-01"),
      endDate: new Date("2026-06-30"),
      isActive: true,
    })
    .returning();

  // Backfill : associer tous les matchs sans saison à la saison courante
  const result = await db
    .update(matches)
    .set({ season: CURRENT_SEASON_LABEL })
    .where(isNull(matches.season));

  logger.info({ season: CURRENT_SEASON_LABEL }, "Saison créée et matchs backfillés");
  return created;
}

/** Retourne le label de la saison active */
export async function getActiveSeasonLabel(): Promise<string> {
  const season = await getOrCreateActiveSeason();
  return season.label;
}

/** Liste toutes les saisons (pour les archives) */
export async function getAllSeasons() {
  return db
    .select()
    .from(seasons)
    .orderBy(seasons.startDate);
}
