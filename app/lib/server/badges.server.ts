import { db } from "~/db/client";
import { badges, userBadges, matchPredictions, feedPosts, comments, reactions, user } from "~/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { createId } from "~/lib/utils";
import { logger } from "./logger.server";

/** Définitions des 10 badges de base */
const BASE_BADGES = [
  {
    key: "premier_pas",
    name: "Premier pas",
    description: "Soumettre son premier pronostic",
    icon: "ball",
    condition: JSON.stringify({ type: "predictions_count", threshold: 1 }),
  },
  {
    key: "voyant",
    name: "Voyant",
    description: "Obtenir son premier score exact",
    icon: "crystal",
    condition: JSON.stringify({ type: "exact_scores", threshold: 1 }),
  },
  {
    key: "regulier",
    name: "Régulier",
    description: "Soumettre 10 pronostics",
    icon: "calendar",
    condition: JSON.stringify({ type: "predictions_count", threshold: 10 }),
  },
  {
    key: "fidele",
    name: "Fidèle",
    description: "Soumettre 50 pronostics",
    icon: "star",
    condition: JSON.stringify({ type: "predictions_count", threshold: 50 }),
  },
  {
    key: "en_serie",
    name: "En série",
    description: "3 scores exacts d'affilée",
    icon: "flame",
    condition: JSON.stringify({ type: "best_streak", threshold: 3 }),
  },
  {
    key: "commentateur",
    name: "Commentateur",
    description: "Publier 10 commentaires",
    icon: "bubble",
    condition: JSON.stringify({ type: "comments_count", threshold: 10 }),
  },
  {
    key: "reactif",
    name: "Réactif",
    description: "50 réactions sur le fil",
    icon: "thumb",
    condition: JSON.stringify({ type: "reactions_count", threshold: 50 }),
  },
  {
    key: "bienvenue",
    name: "Bienvenue",
    description: "Se connecter pour la première fois",
    icon: "door",
    condition: JSON.stringify({ type: "account_created", threshold: 1 }),
  },
  {
    key: "auteur",
    name: "Auteur",
    description: "Publier son premier post",
    icon: "pen",
    condition: JSON.stringify({ type: "posts_count", threshold: 1 }),
  },
  {
    key: "centurion",
    name: "Centurion",
    description: "Atteindre 100 points de pronostics",
    icon: "trophy",
    condition: JSON.stringify({ type: "total_points", threshold: 100 }),
  },
];

/** Icônes emoji pour chaque badge */
export const BADGE_ICONS: Record<string, string> = {
  ball: "\u26BD",
  crystal: "\uD83D\uDD2E",
  calendar: "\uD83D\uDCC5",
  star: "\u2B50",
  flame: "\uD83D\uDD25",
  bubble: "\uD83D\uDCAC",
  thumb: "\uD83D\uDC4D",
  door: "\uD83D\uDEAA",
  pen: "\u270D\uFE0F",
  trophy: "\uD83C\uDFC6",
};

/** Initialise les badges de base en DB si absents */
export async function seedBadges() {
  const existing = await db.select({ key: badges.key }).from(badges);
  const existingKeys = new Set(existing.map((b) => b.key));

  for (const badge of BASE_BADGES) {
    if (!existingKeys.has(badge.key)) {
      await db.insert(badges).values({ id: createId(), ...badge });
    }
  }
}

interface UserStats {
  predictionsCount: number;
  exactScores: number;
  totalPoints: number;
  bestStreak: number;
  commentsCount: number;
  reactionsCount: number;
  postsCount: number;
}

/** Récupère les stats d'un utilisateur pour évaluer les badges */
async function getUserStats(userId: string): Promise<UserStats> {
  const [[predStats], [commentCount], [reactionCount], [postCount]] = await Promise.all([
    db.select({
      predictionsCount: sql<number>`count(*)::int`,
      exactScores: sql<number>`count(case when ${matchPredictions.points} >= 3 then 1 end)::int`,
      totalPoints: sql<number>`coalesce(sum(${matchPredictions.points}), 0)::int`,
    }).from(matchPredictions).where(eq(matchPredictions.userId, userId)),

    db.select({
      count: sql<number>`count(*)::int`,
    }).from(comments).where(eq(comments.authorId, userId)),

    db.select({
      count: sql<number>`count(*)::int`,
    }).from(reactions).where(eq(reactions.userId, userId)),

    db.select({
      count: sql<number>`count(*)::int`,
    }).from(feedPosts).where(eq(feedPosts.authorId, userId)),
  ]);

  const [userRow] = await db.select({ bestStreak: user.bestStreak })
    .from(user)
    .where(eq(user.id, userId));

  return {
    predictionsCount: predStats?.predictionsCount ?? 0,
    exactScores: predStats?.exactScores ?? 0,
    totalPoints: predStats?.totalPoints ?? 0,
    bestStreak: userRow?.bestStreak ?? 0,
    commentsCount: commentCount?.count ?? 0,
    reactionsCount: reactionCount?.count ?? 0,
    postsCount: postCount?.count ?? 0,
  };
}

/** Évalue et attribue les badges pour un utilisateur */
export async function evaluateBadges(userId: string): Promise<string[]> {
  await seedBadges();

  const allBadges = await db.select().from(badges);
  const existing = await db
    .select({ badgeId: userBadges.badgeId })
    .from(userBadges)
    .where(eq(userBadges.userId, userId));
  const ownedBadgeIds = new Set(existing.map((b) => b.badgeId));

  const stats = await getUserStats(userId);
  const newBadges: string[] = [];

  for (const badge of allBadges) {
    if (ownedBadgeIds.has(badge.id)) continue;

    const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
    let value = 0;

    switch (condition.type) {
      case "predictions_count": value = stats.predictionsCount; break;
      case "exact_scores": value = stats.exactScores; break;
      case "total_points": value = stats.totalPoints; break;
      case "best_streak": value = stats.bestStreak; break;
      case "comments_count": value = stats.commentsCount; break;
      case "reactions_count": value = stats.reactionsCount; break;
      case "posts_count": value = stats.postsCount; break;
      case "account_created": value = 1; break;
    }

    if (value >= condition.threshold) {
      await db.insert(userBadges).values({
        id: createId(),
        userId,
        badgeId: badge.id,
      });
      newBadges.push(badge.name);
      logger.info({ userId, badge: badge.key }, `Badge débloqué : ${badge.name}`);
    }
  }

  return newBadges;
}

/** Récupère les badges d'un utilisateur */
export async function getUserBadges(userId: string) {
  const result = await db
    .select({
      key: badges.key,
      name: badges.name,
      description: badges.description,
      icon: badges.icon,
      unlockedAt: userBadges.unlockedAt,
    })
    .from(userBadges)
    .innerJoin(badges, eq(userBadges.badgeId, badges.id))
    .where(eq(userBadges.userId, userId));

  return result;
}

/** Récupère tous les badges avec statut pour un utilisateur */
export async function getAllBadgesWithStatus(userId: string) {
  const allBadges = await db.select().from(badges);
  const owned = await db
    .select({ badgeId: userBadges.badgeId, unlockedAt: userBadges.unlockedAt })
    .from(userBadges)
    .where(eq(userBadges.userId, userId));

  const ownedMap = new Map(owned.map((o) => [o.badgeId, o.unlockedAt]));

  return allBadges.map((b) => ({
    key: b.key,
    name: b.name,
    description: b.description,
    icon: b.icon,
    unlocked: ownedMap.has(b.id),
    unlockedAt: ownedMap.get(b.id)?.toISOString() ?? null,
  }));
}
