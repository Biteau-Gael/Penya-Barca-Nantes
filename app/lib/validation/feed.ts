import { z } from "zod";

export const createPostSchema = z.object({
  content: z.string().min(1, "Le contenu ne peut pas être vide").max(2000, "2000 caractères maximum"),
});

export const createCommentSchema = z.object({
  postId: z.string().min(1),
  content: z.string().min(1, "Le commentaire ne peut pas être vide").max(500, "500 caractères maximum"),
});
