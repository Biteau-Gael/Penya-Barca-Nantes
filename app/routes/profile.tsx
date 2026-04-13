import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateProfileSchema } from "~/lib/validation/user";
import { signOut } from "~/lib/auth.client";
import { profileLoader, profileAction } from "./profile.server";

export const loader = profileLoader;
export const action = profileAction;

interface UserData {
  id: string;
  name: string;
  pseudo: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  gdprConsent: boolean;
  createdAt: string;
}

interface ActionSuccess {
  success: true;
  message: string;
  deleted?: boolean;
}

interface ActionError {
  error: string;
}

type ActionData = ActionSuccess | ActionError;

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

export default function Profile() {
  const { user: userData, stats, predictions, badges, microPronoStats } = useLoaderData<{
    user: UserData & { currentStreak: number; bestStreak: number };
    stats: StatsData;
    predictions: PredictionHistory[];
    badges: { name: string; emoji: string }[];
    microPronoStats: { totalPoints: number; totalAnswers: number };
  }>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [editingPseudo, setEditingPseudo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const createdAt = new Date(userData.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Si le compte a été supprimé, déconnecter côté client
  if (actionData && "deleted" in actionData && actionData.deleted) {
    signOut().then(() => {
      window.location.href = "/";
    });
    return (
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">Suppression en cours...</p>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Mon profil</h1>

        {/* Message de succès / erreur */}
        {actionData && "success" in actionData && actionData.success && (
          <div className="rounded-md bg-success/10 p-3 text-sm text-success">
            {actionData.message}
          </div>
        )}
        {actionData && "error" in actionData && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {actionData.error}
          </div>
        )}

        {/* Avatar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Avatar</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-white text-2xl font-bold overflow-hidden">
              {userData.avatarUrl ? (
                <img
                  src={userData.avatarUrl}
                  alt={`Avatar de ${userData.pseudo || userData.name}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                (userData.pseudo || userData.name).charAt(0).toUpperCase()
              )}
            </div>
            <Form method="post" encType="multipart/form-data" className="flex-1">
              <input type="hidden" name="intent" value="update-avatar" />
              <div className="space-y-2">
                <Label htmlFor="avatar">Changer d'avatar</Label>
                <Input
                  id="avatar"
                  name="avatar"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
                <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP. 2 Mo maximum.</p>
              </div>
              <Button type="submit" size="sm" className="mt-2" disabled={isSubmitting}>
                {isSubmitting ? "Envoi..." : "Envoyer"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        {/* Informations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pseudo */}
            <div>
              <Label className="text-muted-foreground text-xs">Pseudo</Label>
              {editingPseudo ? (
                <Form method="post" className="flex items-center gap-2 mt-1" onSubmit={() => setEditingPseudo(false)}>
                  <input type="hidden" name="intent" value="update-pseudo" />
                  <Input
                    name="pseudo"
                    defaultValue={userData.pseudo || ""}
                    className="max-w-xs"
                    autoFocus
                  />
                  <Button type="submit" size="sm" disabled={isSubmitting}>
                    Enregistrer
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingPseudo(false)}>
                    Annuler
                  </Button>
                </Form>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-foreground font-medium">{userData.pseudo || "Non défini"}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingPseudo(true)}>
                    Modifier
                  </Button>
                </div>
              )}
            </div>

            {/* Email */}
            <div>
              <Label className="text-muted-foreground text-xs">Email</Label>
              <p className="text-foreground mt-1">{userData.email}</p>
            </div>

            {/* Rôle */}
            <div>
              <Label className="text-muted-foreground text-xs">Rôle</Label>
              <p className="text-foreground mt-1 capitalize">{userData.role}</p>
            </div>

            {/* Date d'inscription */}
            <div>
              <Label className="text-muted-foreground text-xs">Membre depuis</Label>
              <p className="text-foreground mt-1">{createdAt}</p>
            </div>
          </CardContent>
        </Card>

        {/* Badges */}
        {badges.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <Link to="/badges" className="hover:text-primary transition-colors">
                  Mes badges ({badges.length})
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {badges.map((b) => (
                  <span
                    key={b.name}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10 text-xs font-medium"
                    title={b.name}
                  >
                    <span>{b.emoji}</span>
                    <span className="text-foreground">{b.name}</span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Statistiques */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mes statistiques</CardTitle>
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
            {microPronoStats.totalAnswers > 0 && (
              <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-border">
                <div className="text-center">
                  <p className="text-lg font-bold text-accent">{microPronoStats.totalPoints}</p>
                  <p className="text-xs text-muted-foreground">Pts micro-pronos</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{microPronoStats.totalAnswers}</p>
                  <p className="text-xs text-muted-foreground">Micro-pronos joués</p>
                </div>
              </div>
            )}
            {(userData.currentStreak > 0 || userData.bestStreak > 0) && (
              <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-border">
                {userData.currentStreak > 0 && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-orange-400">{userData.currentStreak}</p>
                    <p className="text-xs text-muted-foreground">Série en cours</p>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{userData.bestStreak}</p>
                  <p className="text-xs text-muted-foreground">Meilleure série</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Historique des pronostics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historique des pronostics</CardTitle>
          </CardHeader>
          <CardContent>
            {predictions.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                Tes pronostics apparaîtront ici dès le premier match !
              </p>
            ) : (
              <div className="space-y-2">
                {predictions.map((p) => {
                  const date = new Date(p.matchDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                  const BARCA_LOGO = "https://images.fotmob.com/image_resources/logo/teamlogo/8634.png";
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
            )}
          </CardContent>
        </Card>

        {/* RGPD */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mes données personnelles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Conformément au RGPD, voici l'ensemble de vos données personnelles stockées.
            </p>
            <div className="rounded-md bg-muted/50 p-4 text-sm space-y-1">
              <p><strong>Email :</strong> {userData.email}</p>
              <p><strong>Pseudo :</strong> {userData.pseudo || "Non défini"}</p>
              <p><strong>Avatar :</strong> {userData.avatarUrl ? "Oui" : "Aucun"}</p>
              <p><strong>Rôle :</strong> {userData.role}</p>
              <p><strong>Consentement RGPD :</strong> {userData.gdprConsent ? "Oui" : "Non"}</p>
              <p><strong>Inscription :</strong> {createdAt}</p>
            </div>

            {/* Suppression de compte */}
            {showDeleteConfirm ? (
              <div className="rounded-md border border-destructive p-4 space-y-3">
                <p className="text-sm font-medium text-destructive">
                  Êtes-vous sûr ? Cette action est irréversible.
                </p>
                <p className="text-xs text-muted-foreground">
                  Toutes vos données personnelles seront supprimées. Vos pronostics et posts seront anonymisés.
                </p>
                <div className="flex gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete-account" />
                    <Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>
                      {isSubmitting ? "Suppression..." : "Confirmer la suppression"}
                    </Button>
                  </Form>
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                    Annuler
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Supprimer mon compte
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
