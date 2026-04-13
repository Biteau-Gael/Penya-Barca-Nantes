import { pgTable, text, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { user } from "./users";
import { matches } from "./matches";
import { createId } from "~/lib/utils";

export const rewards = pgTable("rewards", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(), // ex: "streak_3", "streak_5", "streak_10"
  streakCount: integer("streak_count").notNull(),
  matchId: text("match_id")
    .references(() => matches.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
