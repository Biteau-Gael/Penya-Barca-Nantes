import { useState } from "react";
import { useLoaderData, useActionData, isRouteErrorResponse, useRouteError, Link, Form, useNavigation } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { matchDetailLoader, matchDetailAction } from "./match-detail.server";
import type { MatchDetails, PlayerInfo, PlayerEvent, MatchStatGroup } from "~/lib/server/api-football.server";

export const loader = matchDetailLoader;
export const action = matchDetailAction;

interface MatchData {
  id: string;
  opponent: string;
  competition: string;
  matchDate: string;
  venue: string;
  homeScore: number | null;
  awayScore: number | null;
  predictionDeadline: string | null;
  pointsScheme: string | null;
  opponentLogo: string | null;
  competitionLogo: string | null;
}

interface PredictionData {
  homeScore: number;
  awayScore: number;
  points: number | null;
}

interface ActionSuccess { success: true; message: string }
interface ActionError { error: string }
type ActionData = ActionSuccess | ActionError;

// --- Sous-composants stats ---

function EventIcon({ type }: { type: PlayerEvent["type"] }) {
  switch (type) {
    case "goal": return <span className="text-sm">⚽</span>;
    case "assist": return <span className="text-sm">👟</span>;
    case "yellowCard": return <span className="inline-block h-3 w-2 rounded-sm bg-yellow-400" />;
    case "redCard": return <span className="inline-block h-3 w-2 rounded-sm bg-red-500" />;
    case "subIn": return <span className="text-sm text-green-500">↑</span>;
    case "subOut": return <span className="text-sm text-red-400">↓</span>;
    default: return null;
  }
}

function PlayerRow({ player }: { player: PlayerInfo }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-6 text-center text-xs text-muted-foreground font-mono">{player.shirtNumber}</span>
        <span className="text-foreground">{player.name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {player.events.map((e, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <EventIcon type={e.type} />
            {e.time && <span className="text-[10px] text-muted-foreground">{e.time}'</span>}
          </span>
        ))}
        {player.rating && (
          <span className={`ml-1 text-xs font-semibold px-1 py-0.5 rounded ${
            player.rating >= 7 ? "bg-green-500/20 text-green-400" :
            player.rating >= 6 ? "bg-yellow-500/20 text-yellow-400" :
            "bg-red-500/20 text-red-400"
          }`}>
            {player.rating.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

function LineupsSection({ details, homeTeam, awayTeam }: { details: MatchDetails; homeTeam: string; awayTeam: string }) {
  if (!details.homeLineup && !details.awayLineup) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Compositions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {[
          { lineup: details.homeLineup, team: homeTeam },
          { lineup: details.awayLineup, team: awayTeam },
        ].map(({ lineup, team }) => lineup && (
          <div key={team}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-foreground">{team}</h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{lineup.formation}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">Entraîneur : {lineup.coach}</p>
            <div className="space-y-0.5">
              {lineup.starters.map((p) => <PlayerRow key={p.id} player={p} />)}
            </div>
            {lineup.subs.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground mt-3 mb-1 border-t border-border pt-2">Remplaçants entrés en jeu</p>
                <div className="space-y-0.5">
                  {lineup.subs.map((p) => <PlayerRow key={p.id} player={p} />)}
                </div>
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EventsSection({ details, homeTeam, awayTeam }: { details: MatchDetails; homeTeam: string; awayTeam: string }) {
  // Collecter tous les événements des deux équipes
  const events: { time: number; type: string; playerName: string; team: string }[] = [];

  const collectEvents = (lineup: MatchDetails["homeLineup"], team: string) => {
    if (!lineup) return;
    for (const player of [...lineup.starters, ...lineup.subs]) {
      for (const e of player.events) {
        if (e.time && (e.type === "goal" || e.type === "yellowCard" || e.type === "redCard")) {
          events.push({ time: e.time, type: e.type, playerName: player.name, team });
        }
      }
    }
  };

  collectEvents(details.homeLineup, homeTeam);
  collectEvents(details.awayLineup, awayTeam);
  events.sort((a, b) => a.time - b.time);

  if (events.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Événements</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {events.map((e, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="w-8 text-right text-xs font-mono text-muted-foreground">{e.time}'</span>
              <EventIcon type={e.type as PlayerEvent["type"]} />
              <span className="text-foreground">{e.playerName}</span>
              <span className="text-xs text-muted-foreground">({e.team})</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StatBar({ home, away, title }: { home: string | number; away: string | number; title: string }) {
  // Extraire les valeurs numériques pour la barre de progression
  const numHome = typeof home === "number" ? home : parseFloat(String(home)) || 0;
  const numAway = typeof away === "number" ? away : parseFloat(String(away)) || 0;
  const total = numHome + numAway || 1;
  const homePct = (numHome / total) * 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-foreground font-medium">{home}</span>
        <span className="text-xs text-muted-foreground">{title}</span>
        <span className="text-foreground font-medium">{away}</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
        <div className="bg-primary/70 transition-all" style={{ width: `${homePct}%` }} />
        <div className="bg-secondary/70 transition-all" style={{ width: `${100 - homePct}%` }} />
      </div>
    </div>
  );
}

function StatsSection({ details }: { details: MatchDetails }) {
  if (details.stats.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Statistiques</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {details.stats.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{group.title}</h3>
            <div className="space-y-3">
              {group.stats.map((s) => (
                <StatBar key={s.key} home={s.home} away={s.away} title={s.title} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// --- Composant principal ---

export default function MatchDetail() {
  const { match, matchDetails, userPrediction, otherPredictions, isLoggedIn } = useLoaderData<{
    match: MatchData;
    matchDetails: MatchDetails | null;
    userPrediction: PredictionData | null;
    otherPredictions: { pseudo: string; homeScore: number; awayScore: number; points: number | null }[];
    isLoggedIn: boolean;
  }>();
  const [activeTab, setActiveTab] = useState<"events" | "lineups" | "stats">("events");
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const BARCA_LOGO = "https://images.fotmob.com/image_resources/logo/teamlogo/8634.png";
  const homeTeam = match.venue === "home" ? "Barça" : match.opponent;
  const awayTeam = match.venue === "home" ? match.opponent : "Barça";
  const homeLogo = match.venue === "home" ? BARCA_LOGO : match.opponentLogo;
  const awayLogo = match.venue === "home" ? match.opponentLogo : BARCA_LOGO;
  const isPast = new Date(match.matchDate) < new Date();
  const deadlinePassed = match.predictionDeadline
    ? new Date() > new Date(match.predictionDeadline)
    : true;
  const pronosOuverts = match.predictionDeadline && !deadlinePassed && !isPast;

  const date = new Date(match.matchDate).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = new Date(match.matchDate).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <Link to="/calendrier" className="text-sm text-primary hover:underline">
          ← Retour au calendrier
        </Link>

        {/* Score / Équipes */}
        <Card className="border-secondary">
          <CardContent className="pt-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              {match.competitionLogo && (
                <img src={match.competitionLogo} alt={match.competition} className="h-5 w-5 object-contain" />
              )}
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {match.competition}
              </p>
            </div>
            <div className="flex items-center justify-center gap-6">
              <div className="text-center space-y-2">
                {homeLogo && (
                  <img src={homeLogo} alt={homeTeam} className="h-12 w-12 mx-auto object-contain" />
                )}
                <p className="text-lg font-bold text-foreground">{homeTeam}</p>
              </div>
              {match.homeScore !== null ? (
                <p className="text-3xl font-bold text-primary">
                  {match.homeScore} - {match.awayScore}
                </p>
              ) : (
                <p className="text-2xl font-bold text-muted-foreground">vs</p>
              )}
              <div className="text-center space-y-2">
                {awayLogo && (
                  <img src={awayLogo} alt={awayTeam} className="h-12 w-12 mx-auto object-contain" />
                )}
                <p className="text-lg font-bold text-foreground">{awayTeam}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Détails enrichis (événements, compos, stats) */}
        {matchDetails && (
          <>
            <div className="flex rounded-lg bg-muted p-1 gap-1">
              {(["events", "lineups", "stats"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${
                    activeTab === tab
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "events" ? "Événements" : tab === "lineups" ? "Compos" : "Stats"}
                </button>
              ))}
            </div>

            {activeTab === "events" && (
              <EventsSection details={matchDetails} homeTeam={homeTeam} awayTeam={awayTeam} />
            )}
            {activeTab === "lineups" && (
              <LineupsSection details={matchDetails} homeTeam={homeTeam} awayTeam={awayTeam} />
            )}
            {activeTab === "stats" && (
              <StatsSection details={matchDetails} />
            )}

            {matchDetails.highlightUrl && (
              <a
                href={matchDetails.highlightUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-medium text-primary hover:bg-muted transition-colors"
              >
                ▶ Voir le résumé vidéo
              </a>
            )}
          </>
        )}

        {/* Infos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="text-foreground font-medium">{date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Heure</span>
              <span className="text-foreground font-medium">{time}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Compétition</span>
              <span className="text-foreground font-medium">{match.competition}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lieu</span>
              <span className="text-foreground font-medium">
                {match.venue === "home" ? "Domicile" : "Extérieur"}
              </span>
            </div>
            {match.predictionDeadline && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deadline pronos</span>
                <span className={`font-medium ${deadlinePassed ? "text-destructive" : "text-success"}`}>
                  {new Date(match.predictionDeadline).toLocaleString("fr-FR")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pronostic */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pronostic</CardTitle>
          </CardHeader>
          <CardContent>
            {actionData && "success" in actionData && (
              <div className="rounded-md bg-success/10 p-3 text-sm text-success mb-4">
                {actionData.message}
              </div>
            )}
            {actionData && "error" in actionData && (
              <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">
                {actionData.error}
              </div>
            )}

            {!isLoggedIn ? (
              <div className="text-center py-4 space-y-3">
                <p className="text-muted-foreground text-sm">
                  Inscris-toi pour pronostiquer et défier les autres culers !
                </p>
                <Button asChild size="sm">
                  <Link to="/inscription">S'inscrire</Link>
                </Button>
              </div>
            ) : pronosOuverts ? (
              <Form method="post" className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  {userPrediction ? "Modifie ton pronostic :" : "Soumets ton pronostic :"}
                </p>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <Label htmlFor="homeScore" className="text-xs text-muted-foreground">
                      {homeTeam}
                    </Label>
                    <Input
                      id="homeScore"
                      name="homeScore"
                      type="number"
                      min="0"
                      max="99"
                      defaultValue={userPrediction?.homeScore ?? ""}
                      className="w-16 text-center text-lg font-bold"
                      required
                    />
                  </div>
                  <span className="text-xl font-bold text-muted-foreground mt-5">-</span>
                  <div className="text-center">
                    <Label htmlFor="awayScore" className="text-xs text-muted-foreground">
                      {awayTeam}
                    </Label>
                    <Input
                      id="awayScore"
                      name="awayScore"
                      type="number"
                      min="0"
                      max="99"
                      defaultValue={userPrediction?.awayScore ?? ""}
                      className="w-16 text-center text-lg font-bold"
                      required
                    />
                  </div>
                </div>
                <div className="text-center">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting
                      ? "Envoi..."
                      : userPrediction
                        ? "Modifier mon pronostic"
                        : "Valider mon pronostic"}
                  </Button>
                </div>
              </Form>
            ) : deadlinePassed && userPrediction ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-sm text-muted-foreground">Ton pronostic :</p>
                <p className="text-2xl font-bold text-primary">
                  {userPrediction.homeScore} - {userPrediction.awayScore}
                </p>
                {userPrediction.points !== null && (
                  <p className="text-sm text-accent font-medium">
                    +{userPrediction.points} points
                  </p>
                )}
              </div>
            ) : isPast ? (
              <p className="text-center text-muted-foreground text-sm py-4">
                Ce match est terminé.
              </p>
            ) : !match.predictionDeadline ? (
              <p className="text-center text-muted-foreground text-sm py-4">
                Les pronostics ne sont pas encore ouverts pour ce match.
              </p>
            ) : (
              <p className="text-center text-muted-foreground text-sm py-4">
                Deadline dépassée — les pronostics sont fermés.
              </p>
            )}
          </CardContent>
        </Card>
        {/* Pronostics des autres membres (après deadline) */}
        {otherPredictions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Pronostics des membres ({otherPredictions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {otherPredictions.map((pred, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                    <span className="text-foreground font-medium">{pred.pseudo}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-secondary">
                        {pred.homeScore} - {pred.awayScore}
                      </span>
                      {pred.points !== null && (
                        <span className="text-xs text-accent font-medium">
                          +{pred.points}pts
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {deadlinePassed && isLoggedIn && otherPredictions.length === 0 && (
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-sm text-muted-foreground">
                Aucun pronostic soumis pour ce match.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <h1 className="text-4xl font-bold text-primary">404</h1>
            <p className="text-muted-foreground">Ce match n'existe pas.</p>
            <Button asChild>
              <Link to="/calendrier">Retour au calendrier</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center space-y-4">
          <h1 className="text-4xl font-bold text-primary">Erreur</h1>
          <p className="text-muted-foreground">Une erreur inattendue est survenue.</p>
          <Button asChild>
            <Link to="/calendrier">Retour au calendrier</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
