import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { events } from "~/db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "~/lib/server/logger.server";
import { createId } from "~/lib/utils";
import { z } from "zod";

const eventSchema = z.object({
  title: z.string().min(1, "Titre requis").max(200),
  description: z.string().optional(),
  eventDate: z.string().min(1, "Date requise").transform((v) => new Date(v)),
  location: z.string().optional(),
});

export async function adminEventsLoader({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const allEvents = await db.select().from(events).orderBy(desc(events.eventDate));

  return {
    events: allEvents.map((e) => ({
      ...e,
      eventDate: e.eventDate.toISOString(),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
  };
}

export async function adminEventsAction({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const result = eventSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description") || undefined,
      eventDate: formData.get("eventDate"),
      location: formData.get("location") || undefined,
    });

    if (!result.success) return { error: result.error.issues[0].message };

    await db.insert(events).values({
      id: createId(),
      title: result.data.title,
      description: result.data.description ?? null,
      eventDate: result.data.eventDate,
      location: result.data.location ?? null,
    });

    logger.info({ action: "event-created", title: result.data.title }, "Événement créé");
    return { success: true, message: "Événement créé avec succès !" };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    if (!id) return { error: "ID manquant." };

    await db.delete(events).where(eq(events.id, id));
    logger.info({ action: "event-deleted", eventId: id }, "Événement supprimé");
    return { success: true, message: "Événement supprimé." };
  }

  return { error: "Action inconnue." };
}
