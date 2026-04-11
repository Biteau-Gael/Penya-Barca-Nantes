import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user, matchPredictions, feedPosts, comments, reactions, matches } from "~/db/schema";
import { sql, gte } from "drizzle-orm";

export async function adminDashboardLoader({ request }: { request: Request }) {
  try {
    await requireAuth(request, ["admin"]);
  } catch {
    throw redirect("/connexion");
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalMembers] = await db.select({ count: sql<number>`COUNT(*)` }).from(user);
  const [recentMembers] = await db.select({ count: sql<number>`COUNT(*)` }).from(user).where(gte(user.createdAt, sevenDaysAgo));
  const [totalMatches] = await db.select({ count: sql<number>`COUNT(*)` }).from(matches);
  const [totalPredictions] = await db.select({ count: sql<number>`COUNT(*)` }).from(matchPredictions);
  const [totalPosts] = await db.select({ count: sql<number>`COUNT(*)` }).from(feedPosts);
  const [recentPosts] = await db.select({ count: sql<number>`COUNT(*)` }).from(feedPosts).where(gte(feedPosts.createdAt, sevenDaysAgo));
  const [totalComments] = await db.select({ count: sql<number>`COUNT(*)` }).from(comments);
  const [totalReactions] = await db.select({ count: sql<number>`COUNT(*)` }).from(reactions);

  return {
    stats: {
      totalMembers: Number(totalMembers.count),
      recentMembers: Number(recentMembers.count),
      totalMatches: Number(totalMatches.count),
      totalPredictions: Number(totalPredictions.count),
      totalPosts: Number(totalPosts.count),
      recentPosts: Number(recentPosts.count),
      totalComments: Number(totalComments.count),
      totalReactions: Number(totalReactions.count),
    },
  };
}
