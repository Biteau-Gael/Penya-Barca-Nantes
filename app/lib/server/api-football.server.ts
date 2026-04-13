import { getEnv } from "~/config/env.server";
import { db } from "~/db/client";
import { matches, matchPredictions } from "~/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.server";
import { createId } from "~/lib/utils";
import { calculatePoints } from "~/lib/points";
import { invalidateStandingsCache } from "~/routes/liga-standings.server";
import { getActiveSeasonLabel } from "~/lib/server/seasons.server";
import { evaluateBadges } from "~/lib/server/badges.server";
import { updateStreak } from "~/lib/server/streaks.server";

const API_BASE = "https://free-api-live-football-data.p.rapidapi.com";
const API_HOST = "free-api-live-football-data.p.rapidapi.com";

/** ID du FC Barcelona dans l'API */
const BARCA_ID = "8634";

/** Ligues à synchroniser pour le Barça (ID API → nom interne) */
const LEAGUES: Record<number, string> = {
  87: "Liga",
  42: "Champions League",
  138: "Copa del Rey",
  139: "Supercoupe",
};

/** URL pattern pour les logos */
const TEAM_LOGO_URL = (teamId: string) =>
  `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`;
const LEAGUE_LOGO_URL = (leagueId: number) =>
  `https://images.fotmob.com/image_resources/logo/leaguelogo/dark/${leagueId}.png`;

// --- Types enrichis pour les détails de match ---

export interface PlayerEvent {
  type: "goal" | "assist" | "yellowCard" | "redCard" | "subIn" | "subOut";
  time?: number;
  reason?: string;
}

export interface PlayerInfo {
  id: number;
  name: string;
  shirtNumber: string;
  positionId?: number;
  rating?: number;
  events: PlayerEvent[];
}

export interface TeamLineup {
  teamId: string;
  teamName: string;
  formation: string;
  coach: string;
  starters: PlayerInfo[];
  subs: PlayerInfo[];
}

export interface MatchStat {
  key: string;
  title: string;
  home: string | number;
  away: string | number;
  type: string;
}

export interface MatchStatGroup {
  title: string;
  stats: MatchStat[];
}

export interface MatchDetails {
  homeLineup: TeamLineup | null;
  awayLineup: TeamLineup | null;
  stats: MatchStatGroup[];
  highlightUrl: string | null;
}

// --- Types API ---

interface ApiMatch {
  id: string;
  home: { id: string; name: string; score: number | null };
  away: { id: string; name: string; score: number | null };
  status: {
    utcTime: string;
    finished: boolean;
    started: boolean;
    cancelled: boolean;
    scoreStr?: string;
    reason?: { short: string };
  };
}

interface LeagueMatchesResponse {
  status: string;
  response: {
    matches: ApiMatch[];
  };
}

// --- API Client ---

async function apiFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const env = getEnv();
  if (!env.API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY non configurée");
  }

  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": env.API_FOOTBALL_KEY,
      "x-rapidapi-host": API_HOST,
    },
  });

  if (!response.ok) {
    throw new Error(`API Football ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/** Récupère tous les matchs du Barça pour une ligue donnée */
async function fetchLeagueMatches(leagueId: number): Promise<ApiMatch[]> {
  const data = await apiFetch<LeagueMatchesResponse>(
    "/football-get-all-matches-by-league",
    { leagueid: String(leagueId) },
  );

  if (data.status !== "success") {
    throw new Error(`API Football: échec pour la ligue ${leagueId}`);
  }

  // Filtrer uniquement les matchs du Barça (comparaison string pour robustesse)
  const barcaMatches = data.response.matches.filter(
    (m) => String(m.home.id) === BARCA_ID || String(m.away.id) === BARCA_ID,
  );

  logger.debug(
    { leagueId, total: data.response.matches.length, barca: barcaMatches.length },
    `Ligue ${leagueId} : ${barcaMatches.length} matchs Barça sur ${data.response.matches.length}`,
  );

  return barcaMatches;
}

/** Synchronise les matchs du Barça depuis l'API */
export async function syncMatches(): Promise<{ created: number; updated: number; total: number }> {
  let created = 0;
  let updated = 0;
  let total = 0;

  const seasonLabel = await getActiveSeasonLabel();

  for (const [leagueId, competitionName] of Object.entries(LEAGUES)) {
    const lid = Number(leagueId);
    let leagueMatches: ApiMatch[];

    try {
      leagueMatches = await fetchLeagueMatches(lid);
    } catch (error) {
      logger.error({ error, leagueId: lid }, `Erreur sync ligue ${competitionName}`);
      continue;
    }

    total += leagueMatches.length;

    for (const apiMatch of leagueMatches) {
      const externalId = Number(apiMatch.id);
      const isHome = apiMatch.home.id === BARCA_ID;
      const opponent = isHome ? apiMatch.away.name : apiMatch.home.name;
      const opponentId = isHome ? apiMatch.away.id : apiMatch.home.id;
      const venue = isHome ? "home" : "away";

      const isFinished = apiMatch.status.finished
        && apiMatch.status.reason?.short === "FT";

      const opponentLogo = TEAM_LOGO_URL(opponentId);
      const competitionLogo = LEAGUE_LOGO_URL(lid);

      // Vérifier si le match existe déjà
      const [existing] = await db
        .select()
        .from(matches)
        .where(eq(matches.externalFixtureId, externalId));

      if (existing) {
        const updatedMatchDate = new Date(apiMatch.status.utcTime);
        const updates: Record<string, unknown> = {
          matchDate: updatedMatchDate,
          opponent,
          competition: competitionName,
          venue,
          opponentLogo,
          competitionLogo,
          updatedAt: new Date(),
        };

        // Mettre à jour la deadline si absente
        if (!existing.predictionDeadline) {
          updates.predictionDeadline = new Date(updatedMatchDate.getTime() - 60 * 60 * 1000);
        }

        // Mettre à jour les scores si terminé et pas encore saisi
        if (isFinished && apiMatch.home.score !== null && existing.homeScore === null) {
          updates.homeScore = apiMatch.home.score;
          updates.awayScore = apiMatch.away.score;

          // Calculer automatiquement les points pour tous les pronostics
          const predictions = await db
            .select()
            .from(matchPredictions)
            .where(eq(matchPredictions.matchId, existing.id));

          for (const pred of predictions) {
            const points = calculatePoints(
              pred.homeScore,
              pred.awayScore,
              apiMatch.home.score!,
              apiMatch.away.score!,
              existing.pointsScheme || "standard",
            );
            await db
              .update(matchPredictions)
              .set({ points, updatedAt: new Date() })
              .where(eq(matchPredictions.id, pred.id));

            // Mettre à jour le streak
            await updateStreak(pred.userId, points >= 3, existing.id);
          }

          if (predictions.length > 0) {
            // Évaluer les badges pour chaque joueur
            const userIds = new Set(predictions.map((p) => p.userId));
            for (const uid of userIds) {
              await evaluateBadges(uid);
            }

            logger.info(
              { matchId: existing.id, predictions: predictions.length },
              `Points calculés automatiquement pour ${predictions.length} pronostics`,
            );
          }

          // Invalider le cache du classement Liga (le classement a pu changer)
          invalidateStandingsCache();
        }

        await db
          .update(matches)
          .set(updates)
          .where(eq(matches.id, existing.id));

        updated++;
      } else {
        const matchDate = new Date(apiMatch.status.utcTime);
        // Deadline pronos = 1h avant le coup d'envoi
        const predictionDeadline = new Date(matchDate.getTime() - 60 * 60 * 1000);

        await db.insert(matches).values({
          id: createId(),
          opponent,
          competition: competitionName,
          matchDate,
          venue,
          homeScore: isFinished ? apiMatch.home.score : null,
          awayScore: isFinished ? apiMatch.away.score : null,
          predictionDeadline,
          opponentLogo,
          competitionLogo,
          externalFixtureId: externalId,
          pointsScheme: "standard",
          season: seasonLabel,
        });

        created++;
      }
    }

    logger.info(
      { leagueId: lid, competition: competitionName, matches: leagueMatches.length },
      `Sync ${competitionName} : ${leagueMatches.length} matchs`,
    );
  }

  logger.info(
    { created, updated, total },
    "Synchronisation API Football terminée",
  );

  return { created, updated, total };
}

// --- Détails enrichis d'un match ---

interface ApiPlayerRaw {
  id: number;
  name: string;
  shirtNumber: string;
  positionId?: number;
  usualPlayingPositionId?: number;
  performance?: {
    rating?: number;
    events?: { type: string; time?: number; reason?: string }[];
    substitutionEvents?: { type: string; time?: number; reason?: string }[];
  };
}

interface ApiLineupResponse {
  status: string;
  response: {
    lineup: {
      id: number;
      name: string;
      formation: string;
      coach: { name: string };
      starters: ApiPlayerRaw[];
      subs: ApiPlayerRaw[];
    };
  };
}

interface ApiStatsResponse {
  status: string;
  response: {
    stats: {
      title: string;
      key: string;
      stats: {
        title: string;
        key: string;
        stats: (string | number | null)[];
        type: string;
      }[];
    }[];
  };
}

interface ApiHighlightsResponse {
  status: string;
  response: {
    highlights?: {
      url?: string;
    };
  };
}

function parsePlayer(raw: ApiPlayerRaw): PlayerInfo {
  const events: PlayerEvent[] = [];

  for (const e of raw.performance?.events ?? []) {
    events.push({
      type: e.type as PlayerEvent["type"],
      time: e.time,
    });
  }
  for (const s of raw.performance?.substitutionEvents ?? []) {
    events.push({
      type: s.type as PlayerEvent["type"],
      time: s.time,
      reason: s.reason,
    });
  }

  return {
    id: raw.id,
    name: raw.name,
    shirtNumber: raw.shirtNumber,
    positionId: raw.positionId ?? raw.usualPlayingPositionId,
    rating: raw.performance?.rating,
    events,
  };
}

function parseLineup(data: ApiLineupResponse["response"]["lineup"], teamId: string): TeamLineup {
  return {
    teamId,
    teamName: data.name,
    formation: data.formation,
    coach: data.coach?.name ?? "Inconnu",
    starters: data.starters.map(parsePlayer),
    subs: data.subs.filter((s) => {
      // Ne garder que les remplaçants effectivement entrés en jeu
      const subEvents = s.performance?.substitutionEvents ?? [];
      return subEvents.some((e) => e.type === "subIn");
    }).map(parsePlayer),
  };
}

function parseStats(data: ApiStatsResponse["response"]["stats"]): MatchStatGroup[] {
  return data
    .filter((group) => group.key !== "top_stats") // Éviter les doublons avec les catégories détaillées
    .map((group) => ({
      title: group.title,
      stats: group.stats
        .filter((s) => s.type !== "title" && s.stats[0] !== null)
        .map((s) => ({
          key: s.key,
          title: s.title,
          home: s.stats[0] ?? 0,
          away: s.stats[1] ?? 0,
          type: s.type,
        })),
    }))
    .filter((g) => g.stats.length > 0);
}

/** Récupère les détails enrichis d'un match (lineups + stats + highlights) */
export async function fetchMatchDetails(eventId: number): Promise<MatchDetails> {
  const eid = String(eventId);

  const [homeLineupRes, awayLineupRes, statsRes, highlightsRes] = await Promise.allSettled([
    apiFetch<ApiLineupResponse>("/football-get-hometeam-lineup", { eventid: eid }),
    apiFetch<ApiLineupResponse>("/football-get-awayteam-lineup", { eventid: eid }),
    apiFetch<ApiStatsResponse>("/football-get-match-event-all-stats", { eventid: eid }),
    apiFetch<ApiHighlightsResponse>("/football-get-match-highlights", { eventid: eid }),
  ]);

  let homeLineup: TeamLineup | null = null;
  let awayLineup: TeamLineup | null = null;
  let stats: MatchStatGroup[] = [];
  let highlightUrl: string | null = null;

  if (homeLineupRes.status === "fulfilled" && homeLineupRes.value.status === "success") {
    const lin = homeLineupRes.value.response.lineup;
    homeLineup = parseLineup(lin, String(lin.id));
  }

  if (awayLineupRes.status === "fulfilled" && awayLineupRes.value.status === "success") {
    const lin = awayLineupRes.value.response.lineup;
    awayLineup = parseLineup(lin, String(lin.id));
  }

  if (statsRes.status === "fulfilled" && statsRes.value.status === "success") {
    stats = parseStats(statsRes.value.response.stats);
  }

  if (highlightsRes.status === "fulfilled" && highlightsRes.value.status === "success") {
    highlightUrl = highlightsRes.value.response.highlights?.url ?? null;
  }

  logger.info({ eventId, hasHome: !!homeLineup, hasAway: !!awayLineup, statsGroups: stats.length }, "Détails match récupérés");

  return { homeLineup, awayLineup, stats, highlightUrl };
}
