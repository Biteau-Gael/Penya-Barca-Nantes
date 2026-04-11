import { useLoaderData } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import { eventsLoader } from "./events.server";

export const loader = eventsLoader;

export function meta() {
  return [
    { title: "Événements — Penya Blaugrana Nantes" },
    { name: "description", content: "Les prochains événements de la Penya Blaugrana Nantes." },
  ];
}

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  location: string | null;
}

export default function Events() {
  const { events } = useLoaderData<{ events: EventItem[] }>();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Événements à venir</h1>

        {events.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            Aucun événement programmé pour le moment. Reste connecté !
          </p>
        ) : (
          <div className="space-y-4">
            {events.map((event) => {
              const date = new Date(event.eventDate).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <Card key={event.id}>
                  <CardContent className="pt-4">
                    <h2 className="text-lg font-semibold text-foreground">{event.title}</h2>
                    <p className="text-sm text-secondary font-medium mt-1">{date}</p>
                    {event.location && (
                      <p className="text-sm text-muted-foreground mt-1">📍 {event.location}</p>
                    )}
                    {event.description && (
                      <p className="text-sm text-foreground mt-2">{event.description}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
