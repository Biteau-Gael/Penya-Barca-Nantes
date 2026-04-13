import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createId } from "~/lib/utils";

export const matches = pgTable("matches", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  opponent: varchar("opponent", { length: 100 }).notNull(),
  competition: varchar("competition", { length: 100 }).notNull(),
  matchDate: timestamp("match_date").notNull(),
  venue: varchar("venue", { length: 20 }).notNull(),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  predictionDeadline: timestamp("prediction_deadline"),
  pointsScheme: varchar("points_scheme", { length: 20 }).default("standard"),
  // API-Football
  externalFixtureId: integer("external_fixture_id").unique(),
  opponentLogo: text("opponent_logo"),
  competitionLogo: text("competition_logo"),
  /** JSON enrichi : lineups, événements, statistiques (cache API) */
  matchDetails: text("match_details"),
  /** Saison (ex: "2025-2026") */
  season: varchar("season", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
