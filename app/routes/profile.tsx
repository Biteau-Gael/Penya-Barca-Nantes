import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
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

export default function Profile() {
  const { user: userData, stats } = useLoaderData<{ user: UserData; stats: StatsData }>();
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
          </CardContent>
        </Card>

        {/* Historique des pronostics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historique des pronostics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6">
              <p className="text-muted-foreground">
                Tes pronostics apparaîtront ici dès le premier match !
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Le calendrier des matchs arrive bientôt 🎉
              </p>
            </div>
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
