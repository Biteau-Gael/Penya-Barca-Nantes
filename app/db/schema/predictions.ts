import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { user } from "./users";
import { matches } from "./matches";
import { createId } from "~/lib/utils";

export const matchPredictions = pgTable("match_predictions", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  matchId: text("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  homeScore: integer("home_score").notNull(),
  awayScore: integer("away_score").notNull(),
  points: integer("points"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
