import { pgTable, text, timestamp, boolean, varchar } from "drizzle-orm/pg-core";
import { createId } from "~/lib/utils";

export const seasons = pgTable("seasons", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  label: varchar("label", { length: 20 }).notNull().unique(), // ex: "2025-2026"
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
