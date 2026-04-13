import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";
import { getAllBadgesWithStatus, BADGE_ICONS } from "~/lib/server/badges.server";

export async function badgesLoader({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const badges = await getAllBadgesWithStatus(session.user.id);

  return {
    badges: badges.map((b) => ({
      ...b,
      emoji: BADGE_ICONS[b.icon] || b.icon,
    })),
    unlockedCount: badges.filter((b) => b.unlocked).length,
    totalCount: badges.length,
  };
}
