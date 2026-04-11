import { db } from "~/db/client";
import { events } from "~/db/schema";
import { asc, gte } from "drizzle-orm";

export async function eventsLoader() {
  const now = new Date();

  const upcomingEvents = await db
    .select()
    .from(events)
    .where(gte(events.eventDate, now))
    .orderBy(asc(events.eventDate));

  return {
    events: upcomingEvents.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      eventDate: e.eventDate.toISOString(),
      location: e.location,
    })),
  };
}
