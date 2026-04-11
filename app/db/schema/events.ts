import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createId } from "~/lib/utils";

export const events = pgTable("events", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  eventDate: timestamp("event_date").notNull(),
  location: varchar("location", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
