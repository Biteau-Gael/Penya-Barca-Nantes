import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { matches, matchPredictions, user, microPredictions, microPredictionAnswers } from "~/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { getEnv } from "~/config/env.server";
import { logger } from "~/lib/server/logger.server";

const API_BASE = "https://free-api-live-football-data.p.rapidapi.com";
const API_HOST = "free-api-live-football-data.p.rapidapi.com";

export interface MatchEvent {
  time: number;
  type: "goal" | "yellowCard" | "redCard" | "subIn";
  playerName: string;
  team: string;
}

interface LiveScore {
  homeScore: number | null;
  awayScore: number | null;
  minute: string | null;
  started: boolean;
  finished: boolean;
}

/** Récupère le score live d'un match via l'API */
async function fetchLiveScore(externalFixtureId: number): Promise<LiveScore | null> {
  const env = getEnv();
  if (!env.API_FOOTBALL_KEY) return null;

  try {
    const url = new URL(`${API_BASE}/football-get-match-score`);
    url.searchParams.set("eventid", String(externalFixtureId));

    const response = await fetch(url.toString(), {
      headers: {
        "x-rapidapi-key": env.API_FOOTBALL_KEY,
        "x-rapidapi-host": API_HOST,
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      status: string;
      response: {
        score?: {
          home: number;
          away: number;
          minute?: string;
          started?: boolean;
          finished?: boolean;
        };
      };
    };

    if (data.status !== "success" || !data.response?.score) return null;

    const s = data.response.score;
    return {
      homeScore: s.home,
      awayScore: s.away,
      minute: s.minute ?? null,
      started: s.started ?? false,
      finished: s.finished ?? false,
    };
  } catch (error) {
    logger.error({ error, externalFixtureId }, "Erreur fetch live score");
    return null;
  }
}

/** Récupère les événements du match (buts, cartons) depuis les lineups API */
async function fetchMatchEvents(externalFixtureId: number): Promise<MatchEvent[]> {
  const env = getEnv();
  if (!env.API_FOOTBALL_KEY) return [];

  const events: MatchEvent[] = [];

  try {
    const [homeRes, awayRes] = await Promise.allSettled([
      fetch(`${API_BASE}/football-get-hometeam-lineup?eventid=${externalFixtureId}`, {
        headers: { "x-rapidapi-key": env.API_FOOTBALL_KEY, "x-rapidapi-host": API_HOST },
      }),
      fetch(`${API_BASE}/football-get-awayteam-lineup?eventid=${externalFixtureId}`, {
        headers: { "x-rapidapi-key": env.API_FOOTBALL_KEY, "x-rapidapi-host": API_HOST },
      }),
    ]);

    const parseLineupEvents = (res: PromiseSettledResult<Response>, label: string) => {
      if (res.status !== "fulfilled") return;
      return res.value.json().then((data: any) => {
        if (data.status !== "success" || !data.response?.lineup) return;
        const lineup = data.response.lineup;
        const teamName = lineup.name || label;
        const allPlayers = [...(lineup.starters || []), ...(lineup.subs || [])];

        for (const player of allPlayers) {
          const perf = player.performance || {};
          for (const e of perf.events || []) {
            if (e.time && ["goal", "yellowCard", "redCard"].includes(e.type)) {
              events.push({
                time: e.time,
                type: e.type,
                playerName: player.name,
                team: teamName,
              });
            }
          }
          for (const s of perf.substitutionEvents || []) {
            if (s.time && s.type === "subIn") {
              events.push({
                time: s.time,
                type: "subIn",
                playerName: player.name,
                team: teamName,
              });
            }
          }
        }
      });
    };

    await Promise.all([
      parseLineupEvents(homeRes, "Domicile"),
      parseLineupEvents(awayRes, "Extérieur"),
    ]);

    events.sort((a, b) => a.time - b.time);
  } catch (error) {
    logger.error({ error, externalFixtureId }, "Erreur fetch match events");
  }

  return events;
}

export async function soireeLoader({
  request,
  params,
}: {
  request: Request;
  params: { matchId: string };
}) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, params.matchId));

  if (!match) {
    throw new Response("Match introuvable", { status: 404 });
  }

  // Score live (si le match a un externalFixtureId)
  let liveScore: LiveScore | null = null;
  if (match.externalFixtureId) {
    liveScore = await fetchLiveScore(match.externalFixtureId);
  }

  // Pronos de la communauté (visibles si le match a commencé)
  const matchStarted = liveScore?.started || new Date(match.matchDate) <= new Date();
  let communityPredictions: { pseudo: string; avatarUrl: string | null; homeScore: number; awayScore: number; points: number | null }[] = [];

  if (matchStarted) {
    const preds = await db
      .select({
        pseudo: user.pseudo,
        name: user.name,
        avatarUrl: user.avatarUrl,
        homeScore: matchPredictions.homeScore,
        awayScore: matchPredictions.awayScore,
        points: matchPredictions.points,
      })
      .from(matchPredictions)
      .innerJoin(user, eq(matchPredictions.userId, user.id))
      .where(eq(matchPredictions.matchId, params.matchId));

    communityPredictions = preds.map((p) => ({
      pseudo: p.pseudo || p.name,
      avatarUrl: p.avatarUrl,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      points: p.points,
    }));
  }

  // Micro-pronostics actifs
  const activeMicros = await db
    .select()
    .from(microPredictions)
    .where(eq(microPredictions.matchId, params.matchId))
    .orderBy(desc(microPredictions.createdAt));

  // Réponses de l'utilisateur aux micro-pronostics
  const userMicroAnswers = await db
    .select({
      microPredictionId: microPredictionAnswers.microPredictionId,
      answer: microPredictionAnswers.answer,
      points: microPredictionAnswers.points,
    })
    .from(microPredictionAnswers)
    .where(eq(microPredictionAnswers.userId, session.user.id));

  const answeredMap = new Map(userMicroAnswers.map((a) => [a.microPredictionId, a]));

  // Événements du match en temps réel
  let matchEvents: MatchEvent[] = [];
  if (match.externalFixtureId && matchStarted) {
    matchEvents = await fetchMatchEvents(match.externalFixtureId);
  }

  // Total points micro-pronos de l'utilisateur pour cette soirée
  let userMicroPoints = 0;
  for (const answer of userMicroAnswers) {
    if (answer.points && answer.points > 0) {
      userMicroPoints += answer.points;
    }
  }

  return {
    match: {
      id: match.id,
      opponent: match.opponent,
      competition: match.competition,
      matchDate: match.matchDate.toISOString(),
      venue: match.venue,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      opponentLogo: match.opponentLogo,
      competitionLogo: match.competitionLogo,
    },
    liveScore,
    matchStarted,
    communityPredictions,
    matchEvents,
    userMicroPoints,
    microPredictions: activeMicros.map((m) => {
      const userAnswer = answeredMap.get(m.id);
      return {
        id: m.id,
        question: m.question,
        type: m.type,
        options: m.options ? JSON.parse(m.options) as string[] : [],
        pointsValue: m.pointsValue,
        deadlineSeconds: m.deadlineSeconds,
        closedAt: m.closedAt?.toISOString() ?? null,
        correctAnswer: m.closedAt ? m.correctAnswer : null,
        createdAt: m.createdAt.toISOString(),
        answered: !!userAnswer,
        userAnswer: userAnswer?.answer ?? null,
        userPoints: userAnswer?.points ?? null,
      };
    }),
    isAdmin: session.user.role === "admin",
    userId: session.user.id,
  };
}
