import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { adminEventsLoader, adminEventsAction } from "./admin.events.server";

export const loader = adminEventsLoader;
export const action = adminEventsAction;

export function meta() {
  return [{ title: "Gestion des événements — Admin Penya" }];
}

interface EventData {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  location: string | null;
}

interface ActionResult { success?: boolean; message?: string; error?: string }

export default function AdminEvents() {
  const { events } = useLoaderData<{ events: EventData[] }>();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Gestion des événements</h1>

        {actionData?.success && (
          <div className="rounded-md bg-success/10 p-3 text-sm text-success">{actionData.message}</div>
        )}
        {actionData?.error && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionData.error}</div>
        )}

        {/* Formulaire création */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ajouter un événement</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="title">Titre</Label>
                  <Input id="title" name="title" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eventDate">Date et heure</Label>
                  <Input id="eventDate" name="eventDate" type="datetime-local" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Lieu</Label>
                  <Input id="location" name="location" placeholder="Bar Solo Nantais" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <textarea
                    id="description"
                    name="description"
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[60px] resize-none"
                    placeholder="Détails de l'événement..."
                  />
                </div>
              </div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Création..." : "Créer l'événement"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        {/* Liste */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Événements ({events.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">Aucun événement programmé.</p>
            ) : (
              <div className="space-y-3">
                {events.map((event) => {
                  const date = new Date(event.eventDate).toLocaleDateString("fr-FR", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const isPast = new Date(event.eventDate) < new Date();

                  return (
                    <div key={event.id} className={`flex items-center justify-between rounded-md border p-3 ${isPast ? "opacity-60" : ""}`}>
                      <div>
                        <p className="font-medium text-foreground">{event.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {date}{event.location ? ` — ${event.location}` : ""}
                        </p>
                        {event.description && (
                          <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {deleteConfirmId === event.id ? (
                          <Form method="post" className="flex gap-1">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={event.id} />
                            <Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>Oui</Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Non</Button>
                          </Form>
                        ) : (
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteConfirmId(event.id)}>
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
