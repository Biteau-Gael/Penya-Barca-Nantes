import { useState, useEffect } from "react";
import { useLoaderData, useRevalidator, Link, useFetcher } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { soireeLoader } from "./soiree.server";

export const loader = soireeLoader;

export function meta() {
  return [{ title: "Soirée match — Penya Blaugrana Nantes" }];
}

const BARCA_LOGO = "https://images.fotmob.com/image_resources/logo/teamlogo/8634.png";

interface LoaderData {
  match: {
    id: string;
    opponent: string;
    competition: string;
    matchDate: string;
    venue: string;
    homeScore: number | null;
    awayScore: number | null;
    opponentLogo: string | null;
    competitionLogo: string | null;
  };
  liveScore: {
    homeScore: number | null;
    awayScore: number | null;
    minute: string | null;
    started: boolean;
    finished: boolean;
  } | null;
  matchStarted: boolean;
  communityPredictions: {
    pseudo: string;
    avatarUrl: string | null;
    homeScore: number;
    awayScore: number;
    points: number | null;
  }[];
  matchEvents: {
    time: number;
    type: "goal" | "yellowCard" | "redCard" | "subIn";
    playerName: string;
    team: string;
  }[];
  userMicroPoints: number;
  microPredictions: {
    id: string;
    question: string;
    type: string;
    options: string[];
    pointsValue: number;
    deadlineSeconds: number;
    closedAt: string | null;
    correctAnswer: string | null;
    createdAt: string;
    answered: boolean;
    userAnswer: string | null;
    userPoints: number | null;
  }[];
  isAdmin: boolean;
  userId: string;
}

export default function Soiree() {
  const data = useLoaderData<LoaderData>();
  const { match, liveScore, matchStarted, communityPredictions, microPredictions, matchEvents, userMicroPoints, isAdmin } = data;
  const revalidator = useRevalidator();
  const fetcher = useFetcher();

  // Auto-refresh toutes les 60s si le match est en cours
  const isLive = liveScore?.started && !liveScore?.finished;
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => revalidator.revalidate(), 60_000);
    return () => clearInterval(interval);
  }, [isLive]);

  const homeTeam = match.venue === "home" ? "Barça" : match.opponent;
  const awayTeam = match.venue === "home" ? match.opponent : "Barça";
  const homeLogo = match.venue === "home" ? BARCA_LOGO : match.opponentLogo;
  const awayLogo = match.venue === "home" ? match.opponentLogo : BARCA_LOGO;

  // Score affiché : live > DB
  const displayHome = liveScore?.homeScore ?? match.homeScore;
  const displayAway = liveScore?.awayScore ?? match.awayScore;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <Link to={`/matchs/${match.id}`} className="text-sm text-primary hover:underline">
          ← Détails du match
        </Link>

        {/* Score live */}
        <Card className={isLive ? "border-green-500/50 shadow-green-500/10 shadow-lg" : "border-secondary"}>
          <CardContent className="pt-5 text-center">
            {isLive && (
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="text-xs font-bold text-green-400 uppercase tracking-wider">
                  En direct — {liveScore?.minute}'
                </span>
              </div>
            )}
            {liveScore?.finished && (
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Terminé</p>
            )}
            <div className="flex items-center justify-center gap-2 mb-2">
              {match.competitionLogo && (
                <img src={match.competitionLogo} alt="" className="h-4 w-4 object-contain" />
              )}
              <span className="text-xs text-muted-foreground">{match.competition}</span>
            </div>
            <div className="flex items-center justify-center gap-6">
              <div className="text-center space-y-2">
                {homeLogo && <img src={homeLogo} alt={homeTeam} className="h-14 w-14 mx-auto object-contain" />}
                <p className="text-sm font-bold text-foreground">{homeTeam}</p>
              </div>
              {displayHome !== null ? (
                <p className={`text-4xl font-black ${isLive ? "text-green-400" : "text-primary"}`}>
                  {displayHome} - {displayAway}
                </p>
              ) : (
                <p className="text-2xl font-bold text-muted-foreground">vs</p>
              )}
              <div className="text-center space-y-2">
                {awayLogo && <img src={awayLogo} alt={awayTeam} className="h-14 w-14 mx-auto object-contain" />}
                <p className="text-sm font-bold text-foreground">{awayTeam}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Score micro-pronos */}
        {userMicroPoints > 0 && (
          <div className="rounded-lg bg-accent/10 p-3 text-center">
            <span className="text-sm text-muted-foreground">Tes points micro-pronos : </span>
            <span className="text-lg font-bold text-accent">+{userMicroPoints}</span>
          </div>
        )}

        {/* Événements du match en temps réel */}
        {matchEvents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fil du match</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {matchEvents.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-8 text-right text-xs font-mono text-muted-foreground">{e.time}'</span>
                    <span className="text-sm">
                      {e.type === "goal" && "\u26BD"}
                      {e.type === "yellowCard" && <span className="inline-block h-3.5 w-2.5 rounded-sm bg-yellow-400" />}
                      {e.type === "redCard" && <span className="inline-block h-3.5 w-2.5 rounded-sm bg-red-500" />}
                      {e.type === "subIn" && <span className="text-green-500">\u2191</span>}
                    </span>
                    <span className="text-foreground">{e.playerName}</span>
                    <span className="text-xs text-muted-foreground">({e.team})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Admin : créer un micro-pronostic */}
        {isAdmin && matchStarted && (
          <Card className="border-dashed border-accent/30">
            <CardContent className="pt-4">
              <fetcher.Form method="post" action="/api/micro-predictions" className="space-y-3">
                <input type="hidden" name="intent" value="create" />
                <input type="hidden" name="matchId" value={match.id} />
                <p className="text-xs font-bold text-accent uppercase">Nouveau micro-pronostic</p>
                <input
                  name="question"
                  placeholder="Question..."
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <input
                  name="options"
                  placeholder="Options séparées par des virgules"
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <button
                  type="submit"
                  className="w-full py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
                >
                  Lancer
                </button>
              </fetcher.Form>
            </CardContent>
          </Card>
        )}

        {/* Micro-pronostics actifs */}
        {microPredictions.filter((m) => !m.closedAt).map((micro) => (
          <Card key={micro.id} className="border-accent/50 bg-accent/5">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-accent">Micro-pronostic</p>
                <span className="text-xs text-muted-foreground">+{micro.pointsValue} pt</span>
              </div>
              <p className="text-sm text-foreground font-medium">{micro.question}</p>
              {micro.answered ? (
                <p className="text-xs text-muted-foreground text-center py-2">Réponse envoyée !</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {micro.options.map((option, i) => (
                    <fetcher.Form key={i} method="post" action="/api/micro-predictions">
                      <input type="hidden" name="intent" value="answer" />
                      <input type="hidden" name="microId" value={micro.id} />
                      <input type="hidden" name="answer" value={option} />
                      <button
                        type="submit"
                        className="w-full py-2 px-3 rounded-md border border-border text-sm text-foreground hover:bg-primary hover:text-white hover:border-primary transition-colors"
                      >
                        {option}
                      </button>
                    </fetcher.Form>
                  ))}
                </div>
              )}
              {isAdmin && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                  <fetcher.Form method="post" action="/api/micro-predictions" className="flex gap-2 flex-1">
                    <input type="hidden" name="intent" value="close" />
                    <input type="hidden" name="microId" value={micro.id} />
                    <input
                      name="correctAnswer"
                      placeholder="Bonne réponse..."
                      required
                      className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                    >
                      Clôturer
                    </button>
                  </fetcher.Form>
                  <fetcher.Form method="post" action="/api/micro-predictions">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="microId" value={micro.id} />
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-md bg-red-600/20 text-red-400 text-xs font-medium hover:bg-red-600/30"
                    >
                      Supprimer
                    </button>
                  </fetcher.Form>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Micro-pronostics clôturés */}
        {microPredictions.filter((m) => m.closedAt).map((micro) => {
          const isCorrect = micro.userAnswer?.toLowerCase().trim() === micro.correctAnswer?.toLowerCase().trim();
          return (
            <Card key={micro.id} className="opacity-75">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Micro-pronostic terminé</p>
                  {micro.userPoints !== null && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      micro.userPoints > 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {micro.userPoints > 0 ? `+${micro.userPoints}` : "0"} pt
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground">{micro.question}</p>
                {micro.correctAnswer && (
                  <p className="text-sm font-bold text-green-400">Réponse : {micro.correctAnswer}</p>
                )}
                {micro.userAnswer && (
                  <p className={`text-xs ${isCorrect ? "text-green-400" : "text-red-400"}`}>
                    Ta réponse : {micro.userAnswer} {isCorrect ? "✓" : "✗"}
                  </p>
                )}
                {!micro.answered && (
                  <p className="text-xs text-muted-foreground">Tu n'as pas répondu</p>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Pronos de la communauté */}
        {matchStarted && communityPredictions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Pronostics de la communauté ({communityPredictions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {communityPredictions.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-white text-xs font-bold overflow-hidden shrink-0">
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          p.pseudo.charAt(0).toUpperCase()
                        )}
                      </div>
                      <span className="text-foreground font-medium">{p.pseudo}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-secondary">{p.homeScore} - {p.awayScore}</span>
                      {p.points !== null && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          p.points >= 3 ? "bg-green-500/20 text-green-400" :
                          p.points > 0 ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>
                          +{p.points}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {!matchStarted && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Les pronostics seront révélés au coup d'envoi !
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {new Date(match.matchDate).toLocaleDateString("fr-FR", {
                  weekday: "long", day: "numeric", month: "long",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
