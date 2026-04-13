import { db } from "~/db/client";
import { user, rewards, feedPosts } from "~/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "~/lib/utils";
import { logger } from "./logger.server";

/** Paliers de récompense */
const STREAK_MILESTONES = [3, 5, 10];

/**
 * Met à jour le streak d'un utilisateur après un calcul de points.
 * @param isExactScore true si le pronostic était un score exact (points >= 3)
 * @param matchId ID du match pour la récompense
 * @returns les badges de streak débloqués
 */
export async function updateStreak(
  userId: string,
  isExactScore: boolean,
  matchId: string,
): Promise<string[]> {
  const [userData] = await db
    .select({ currentStreak: user.currentStreak, bestStreak: user.bestStreak })
    .from(user)
    .where(eq(user.id, userId));

  if (!userData) return [];

  let newStreak: number;
  let newBest = userData.bestStreak;
  const earnedRewards: string[] = [];

  if (isExactScore) {
    newStreak = userData.currentStreak + 1;
    if (newStreak > newBest) newBest = newStreak;

    // Vérifier les paliers
    for (const milestone of STREAK_MILESTONES) {
      if (newStreak === milestone) {
        const rewardType = `streak_${milestone}`;

        await db.insert(rewards).values({
          id: createId(),
          userId,
          type: rewardType,
          streakCount: milestone,
          matchId,
        });

        // Post auto dans le fil communautaire
        const [userInfo] = await db
          .select({ pseudo: user.pseudo, name: user.name })
          .from(user)
          .where(eq(user.id, userId));

        const displayName = userInfo?.pseudo || userInfo?.name || "Un membre";
        let message = "";

        if (milestone === 3) {
          message = `${displayName} enchaîne 3 scores exacts d'affilée ! Une boisson offerte au Bar Solo !`;
        } else if (milestone === 5) {
          message = `${displayName} est en feu : 5 scores exacts d'affilée !`;
        } else if (milestone === 10) {
          message = `${displayName} est inarrêtable : 10 scores exacts d'affilée ! Légende de la Penya !`;
        }

        if (message) {
          await db.insert(feedPosts).values({
            id: createId(),
            authorId: userId,
            content: message,
            isAnnouncement: true,
          });
        }

        earnedRewards.push(rewardType);
        logger.info({ userId, milestone, matchId }, `Récompense streak ${milestone} attribuée`);
      }
    }
  } else {
    // Série brisée
    newStreak = 0;
  }

  await db
    .update(user)
    .set({
      currentStreak: newStreak,
      bestStreak: newBest,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId));

  return earnedRewards;
}
