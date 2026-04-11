import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { COMPETITIONS, VENUES } from "~/lib/validation/match";
import { adminMatchesLoader, adminMatchesAction } from "./admin.matches.server";

export const loader = adminMatchesLoader;
export const action = adminMatchesAction;

const POINTS_SCHEMES = [
  { value: "standard", label: "Standard (3-1-0)" },
  { value: "strict", label: "Strict (5-1-0)" },
  { value: "souple", label: "Souple (3-2-1)" },
] as const;

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

interface ActionSuccess { success: true; message: string }
interface ActionError { error: string }
type ActionData = ActionSuccess | ActionError;

export default function AdminMatches() {
  const { matches } = useLoaderData<{ matches: MatchData[] }>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);

  const editingMatch = editingId ? matches.find((m) => m.id === editingId) : null;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Gestion des matchs</h1>

        {actionData && "success" in actionData && (
          <div className="rounded-md bg-success/10 p-3 text-sm text-success">
            {actionData.message}
          </div>
        )}
        {actionData && "error" in actionData && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {actionData.error}
          </div>
        )}

        {/* Formulaire création / édition */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {editingMatch ? "Modifier le match" : "Ajouter un match"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4" onSubmit={() => setEditingId(null)}>
              <input type="hidden" name="intent" value={editingMatch ? "update" : "create"} />
              {editingMatch && <input type="hidden" name="id" value={editingMatch.id} />}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="opponent">Adversaire</Label>
                  <Input
                    id="opponent"
                    name="opponent"
                    defaultValue={editingMatch?.opponent ?? ""}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="competition">Compétition</Label>
                  <select
                    id="competition"
                    name="competition"
                    defaultValue={editingMatch?.competition ?? "Liga"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    required
                  >
                    {COMPETITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="matchDate">Date et heure</Label>
                  <Input
                    id="matchDate"
                    name="matchDate"
                    type="datetime-local"
                    defaultValue={
                      editingMatch
                        ? new Date(editingMatch.matchDate).toISOString().slice(0, 16)
                        : ""
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Lieu</Label>
                  <div className="flex gap-4 mt-1">
                    {VENUES.map((v) => (
                      <label key={v} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="venue"
                          value={v}
                          defaultChecked={editingMatch ? editingMatch.venue === v : v === "home"}
                          className="h-4 w-4"
                        />
                        {v === "home" ? "Domicile" : "Extérieur"}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="predictionDeadline">Deadline pronostics</Label>
                  <Input
                    id="predictionDeadline"
                    name="predictionDeadline"
                    type="datetime-local"
                    defaultValue={
                      editingMatch?.predictionDeadline
                        ? new Date(editingMatch.predictionDeadline).toISOString().slice(0, 16)
                        : ""
                    }
                  />
                  <p className="text-xs text-muted-foreground">Laisser vide = pronostics fermés</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pointsScheme">Barème de points</Label>
                  <select
                    id="pointsScheme"
                    name="pointsScheme"
                    defaultValue={editingMatch?.pointsScheme ?? "standard"}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    {POINTS_SCHEMES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? "Enregistrement..."
                    : editingMatch
                      ? "Modifier"
                      : "Créer le match"}
                </Button>
                {editingMatch && (
                  <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                    Annuler
                  </Button>
                )}
              </div>
            </Form>
          </CardContent>
        </Card>

        {/* Liste des matchs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Matchs ({matches.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {matches.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                Aucun match programmé.
              </p>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => {
                  const date = new Date(match.matchDate).toLocaleDateString("fr-FR", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const isPast = new Date(match.matchDate) < new Date();

                  return (
                    <div
                      key={match.id}
                      className={`flex items-center justify-between rounded-md border p-3 ${
                        isPast ? "opacity-60" : ""
                      }`}
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          {match.venue === "home" ? "Barça" : match.opponent}
                          {" vs "}
                          {match.venue === "home" ? match.opponent : "Barça"}
                          {match.homeScore !== null && (
                            <span className="ml-2 text-primary font-bold">
                              ({match.homeScore} - {match.awayScore})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {match.competition} — {date} — {match.venue === "home" ? "Domicile" : "Extérieur"}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                        {isPast && match.homeScore === null && (
                          scoringId === match.id ? (
                            <Form method="post" className="flex items-center gap-1">
                              <input type="hidden" name="intent" value="set-result" />
                              <input type="hidden" name="id" value={match.id} />
                              <Input name="homeScore" type="number" min="0" className="w-12 h-8 text-center text-sm" placeholder="D" required />
                              <span className="text-xs">-</span>
                              <Input name="awayScore" type="number" min="0" className="w-12 h-8 text-center text-sm" placeholder="E" required />
                              <Button type="submit" size="sm" disabled={isSubmitting}>OK</Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => setScoringId(null)}>✕</Button>
                            </Form>
                          ) : (
                            <Button variant="outline" size="sm" className="text-accent" onClick={() => setScoringId(match.id)}>
                              Score
                            </Button>
                          )
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(match.id)}
                        >
                          Modifier
                        </Button>
                        {deleteConfirmId === match.id ? (
                          <Form method="post" className="flex gap-1">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={match.id} />
                            <Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>
                              Confirmer
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteConfirmId(null)}
                            >
                              Non
                            </Button>
                          </Form>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setDeleteConfirmId(match.id)}
                          >
                            Supprimer
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
