import { useLoaderData, isRouteErrorResponse, useRouteError, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { memberProfileLoader } from "./member-profile.server";

export const loader = memberProfileLoader;

interface MemberData {
  id: string;
  name: string;
  pseudo: string | null;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
}

interface StatsData {
  totalPredictions: number;
  totalPoints: number;
  successRate: number;
}

interface PredictionHistory {
  matchId: string;
  opponent: string;
  competition: string;
  matchDate: string;
  venue: string;
  homeScore: number | null;
  awayScore: number | null;
  predHomeScore: number;
  predAwayScore: number;
  points: number | null;
  opponentLogo: string | null;
}

export default function MemberProfile() {
  const { member, stats, predictions } = useLoaderData<{ member: MemberData; stats: StatsData; predictions: PredictionHistory[] }>();

  const displayName = member.pseudo || member.name;
  const createdAt = new Date(member.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-md space-y-6">
        {/* Profil */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary text-white text-3xl font-bold overflow-hidden">
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt={`Avatar de ${displayName}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  displayName.charAt(0).toUpperCase()
                )}
              </div>
              <h1 className="mt-4 text-2xl font-bold text-foreground">
                {displayName}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground capitalize">
                {member.role}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Membre depuis le {createdAt}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Statistiques */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Statistiques</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-primary">{stats.totalPredictions}</p>
                <p className="text-xs text-muted-foreground">Pronostics</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-secondary">{stats.totalPoints}</p>
                <p className="text-xs text-muted-foreground">Points</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-accent">{stats.successRate}%</p>
                <p className="text-xs text-muted-foreground">Réussite</p>
              </div>
            </div>
            {stats.totalPredictions === 0 && (
              <p className="text-center text-xs text-muted-foreground mt-4">
                Les statistiques apparaîtront dès les premiers pronostics.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Historique des pronostics */}
        {predictions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Historique des pronostics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {predictions.map((p) => {
                  const date = new Date(p.matchDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                  return (
                    <Link
                      key={p.matchId}
                      to={`/matchs/${p.matchId}`}
                      className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {p.opponentLogo && (
                          <img src={p.opponentLogo} alt={p.opponent} className="h-6 w-6 object-contain shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {p.venue === "home" ? "Barça" : p.opponent} - {p.venue === "home" ? p.opponent : "Barça"}
                          </p>
                          <p className="text-xs text-muted-foreground">{date} · {p.competition}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-secondary">
                          {p.predHomeScore} - {p.predAwayScore}
                        </p>
                        {p.homeScore !== null && (
                          <p className="text-xs text-muted-foreground">
                            Réel : {p.homeScore} - {p.awayScore}
                          </p>
                        )}
                      </div>
                      {p.points !== null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
                          p.points >= 3 ? "bg-green-500/20 text-green-400" :
                          p.points > 0 ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>
                          +{p.points}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
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
            <p className="text-muted-foreground">
              Ce membre n'existe pas ou a été supprimé.
            </p>
            <Button asChild>
              <Link to="/">Retour à l'accueil</Link>
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
          <p className="text-muted-foreground">
            Une erreur inattendue est survenue.
          </p>
          <Button asChild>
            <Link to="/">Retour à l'accueil</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
