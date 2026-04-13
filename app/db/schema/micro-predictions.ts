import { pgTable, text, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { user } from "./users";
import { matches } from "./matches";
import { createId } from "~/lib/utils";

export const microPredictions = pgTable("micro_predictions", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  matchId: text("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  /** "qcm" | "score" | "player" */
  type: varchar("type", { length: 20 }).notNull(),
  /** Options JSON pour QCM : ["Option A", "Option B", ...] */
  options: text("options"),
  /** Réponse correcte (texte libre ou index d'option) */
  correctAnswer: text("correct_answer"),
  /** Points attribués pour une bonne réponse */
  pointsValue: integer("points_value").notNull().default(1),
  /** Délai en secondes pour répondre */
  deadline: integer("deadline_seconds").notNull().default(120),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const microPredictionAnswers = pgTable("micro_prediction_answers", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  microPredictionId: text("micro_prediction_id")
    .notNull()
    .references(() => microPredictions.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  answer: text("answer").notNull(),
  points: integer("points"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
