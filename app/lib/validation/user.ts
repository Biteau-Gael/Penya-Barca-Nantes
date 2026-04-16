import { z } from "zod";

export const registerSchema = z
  .object({
    email: z.string().email("Email invalide"),
    pseudo: z
      .string()
      .min(3, "Pseudo : 3 caractères minimum")
      .max(30, "Pseudo : 30 caractères maximum")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Pseudo : lettres, chiffres, _ et - uniquement",
      ),
    password: z
      .string()
      .min(8, "Mot de passe : 8 caractères minimum")
      .regex(
        /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Mot de passe : majuscule, minuscule et chiffre requis",
      ),
    confirmPassword: z.string(),
    gdprConsent: z.literal(true, {
      errorMap: () => ({
        message: "Vous devez accepter la politique de confidentialité",
      }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;

/** Server-side schema for sign-up payload validation (no confirmPassword) */
export const signUpServerSchema = z.object({
  name: z
    .string()
    .min(3, "Pseudo : 3 caractères minimum")
    .max(30, "Pseudo : 30 caractères maximum")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Pseudo : lettres, chiffres, _ et - uniquement",
    ),
  email: z.string().email("Email invalide"),
  password: z
    .string()
    .min(8, "Mot de passe : 8 caractères minimum")
    .regex(
      /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Mot de passe : majuscule, minuscule et chiffre requis",
    ),
});

export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  pseudo: z
    .string()
    .min(3, "Pseudo : 3 caractères minimum")
    .max(30, "Pseudo : 30 caractères maximum")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Pseudo : lettres, chiffres, _ et - uniquement",
    ),
});

export type UpdateProfileFormData = z.infer<typeof updateProfileSchema>;
