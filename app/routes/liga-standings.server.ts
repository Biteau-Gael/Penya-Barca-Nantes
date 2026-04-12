import { getEnv } from "~/config/env.server";
import { logger } from "~/lib/server/logger.server";

const API_BASE = "https://free-api-live-football-data.p.rapidapi.com";
const API_HOST = "free-api-live-football-data.p.rapidapi.com";

const TEAM_LOGO_URL = (teamId: number) =>
  `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`;

export interface StandingEntry {
  position: number;
  teamId: number;
  name: string;
  logo: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  qualColor: string | null;
  isBarca: boolean;
}

interface ApiStandingEntry {
  name: string;
  id: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoresStr: string;
  goalConDiff: number;
  pts: number;
  idx: number;
  qualColor: string | null;
}

/** Cache en mémoire — invalidé uniquement quand un match Liga se termine */
let standingsCache: StandingEntry[] | null = null;

async function fetchStandings(): Promise<StandingEntry[]> {
  const env = getEnv();
  if (!env.API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY non configurée");
  }

  const url = new URL(`${API_BASE}/football-get-standing-all`);
  url.searchParams.set("leagueid", "87");

  const response = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": env.API_FOOTBALL_KEY,
      "x-rapidapi-host": API_HOST,
    },
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }

  const data = await response.json() as { status: string; response: { standing: ApiStandingEntry[] } };

  if (data.status !== "success" || !data.response?.standing) {
    throw new Error("Données indisponibles");
  }

  return data.response.standing.map((t) => {
    const [gf, ga] = t.scoresStr.split("-").map(Number);
    return {
      position: t.idx,
      teamId: t.id,
      name: t.name,
      logo: TEAM_LOGO_URL(t.id),
      played: t.played,
      wins: t.wins,
      draws: t.draws,
      losses: t.losses,
      goalsFor: gf,
      goalsAgainst: ga,
      goalDiff: t.goalConDiff,
      points: t.pts,
      qualColor: t.qualColor,
      isBarca: t.id === 8634,
    };
  });
}

/** Invalide le cache — à appeler après qu'un match Liga se termine */
export function invalidateStandingsCache() {
  standingsCache = null;
}

export async function ligaStandingsLoader() {
  if (standingsCache) {
    return { standings: standingsCache, error: null };
  }

  try {
    const standings = await fetchStandings();
    standingsCache = standings;
    logger.info("Classement Liga mis en cache");
    return { standings, error: null };
  } catch (error) {
    logger.error({ error }, "Erreur fetch classement Liga");
    return { standings: [], error: "Impossible de charger le classement." };
  }
}
