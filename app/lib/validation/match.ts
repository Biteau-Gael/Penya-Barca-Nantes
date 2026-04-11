import { z } from "zod";

export const COMPETITIONS = [
  "Liga",
  "Champions League",
  "Copa del Rey",
  "Supercoupe",
  "Amical",
] as const;

export const VENUES = ["home", "away"] as const;

export const createMatchSchema = z.object({
  opponent: z
    .string()
    .min(1, "Adversaire requis")
    .max(100, "Adversaire : 100 caractères maximum"),
  competition: z.enum(COMPETITIONS, {
    errorMap: () => ({ message: "Compétition invalide" }),
  }),
  matchDate: z
    .string()
    .min(1, "Date et heure requises")
    .transform((val) => new Date(val))
    .refine((date) => date > new Date(), {
      message: "La date doit être dans le futur",
    }),
  venue: z.enum(VENUES, {
    errorMap: () => ({ message: "Lieu requis (domicile ou extérieur)" }),
  }),
});

export type CreateMatchFormData = z.infer<typeof createMatchSchema>;

export const updateMatchSchema = z.object({
  id: z.string().min(1),
  opponent: z
    .string()
    .min(1, "Adversaire requis")
    .max(100, "Adversaire : 100 caractères maximum"),
  competition: z.enum(COMPETITIONS, {
    errorMap: () => ({ message: "Compétition invalide" }),
  }),
  matchDate: z
    .string()
    .min(1, "Date et heure requises")
    .transform((val) => new Date(val)),
  venue: z.enum(VENUES, {
    errorMap: () => ({ message: "Lieu requis (domicile ou extérieur)" }),
  }),
});

export type UpdateMatchFormData = z.infer<typeof updateMatchSchema>;
