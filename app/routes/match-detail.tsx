import { useLoaderData, useActionData, isRouteErrorResponse, useRouteError, Link, Form, useNavigation } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { matchDetailLoader, matchDetailAction } from "./match-detail.server";

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
}

interface PredictionData {
  homeScore: number;
  awayScore: number;
  points: number | null;
}

interface ActionSuccess { success: true; message: string }
interface ActionError { error: string }
type ActionData = ActionSuccess | ActionError;

export default function MatchDetail() {
  const { match, userPrediction, otherPredictions, isLoggedIn } = useLoaderData<{
    match: MatchData;
    userPrediction: PredictionData | null;
    otherPredictions: { pseudo: string; homeScore: number; awayScore: number; points: number | null }[];
    isLoggedIn: boolean;
  }>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const homeTeam = match.venue === "home" ? "Barça" : match.opponent;
  const awayTeam = match.venue === "home" ? match.opponent : "Barça";
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
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
              {match.competition}
            </p>
            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{homeTeam}</p>
              </div>
              {match.homeScore !== null ? (
                <p className="text-3xl font-bold text-primary">
                  {match.homeScore} - {match.awayScore}
                </p>
              ) : (
                <p className="text-2xl font-bold text-muted-foreground">vs</p>
              )}
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{awayTeam}</p>
              </div>
            </div>
          </CardContent>
        </Card>

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
