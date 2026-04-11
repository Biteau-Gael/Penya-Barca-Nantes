import { z } from "zod";

export const predictionSchema = z.object({
  matchId: z.string().min(1, "Match requis"),
  homeScore: z.coerce
    .number()
    .int("Score entier requis")
    .min(0, "Score positif requis")
    .max(99, "Score invalide"),
  awayScore: z.coerce
    .number()
    .int("Score entier requis")
    .min(0, "Score positif requis")
    .max(99, "Score invalide"),
});

export type PredictionFormData = z.infer<typeof predictionSchema>;
