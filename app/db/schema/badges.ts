import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user } from "./users";
import { createId } from "~/lib/utils";

export const badges = pgTable("badges", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  key: varchar("key", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  icon: varchar("icon", { length: 50 }).notNull(),
  /** Condition JSON : { "type": "predictions_count", "threshold": 10 } */
  condition: text("condition").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userBadges = pgTable("user_badges", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  badgeId: text("badge_id")
    .notNull()
    .references(() => badges.id, { onDelete: "cascade" }),
  unlockedAt: timestamp("unlocked_at").defaultNow().notNull(),
});
