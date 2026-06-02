import { redirect } from "react-router";
import { requireAuth, getSession } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { feedPosts, comments, reactions, user } from "~/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { createPostSchema, createCommentSchema } from "~/lib/validation/feed";
import { logger } from "~/lib/server/logger.server";
import { createId } from "~/lib/utils";
import { evaluateBadges } from "~/lib/server/badges.server";

export async function feedLoader({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const posts = await db
    .select({
      id: feedPosts.id,
      content: feedPosts.content,
      imageUrl: feedPosts.imageUrl,
      isAnnouncement: feedPosts.isAnnouncement,
      createdAt: feedPosts.createdAt,
      authorId: feedPosts.authorId,
      authorPseudo: user.pseudo,
      authorName: user.name,
      authorAvatarUrl: user.avatarUrl,
      authorRole: user.role,
    })
    .from(feedPosts)
    .innerJoin(user, eq(feedPosts.authorId, user.id))
    .orderBy(desc(feedPosts.createdAt))
    .limit(50);

  // Pour chaque post, compter les réactions et commentaires
  const postsWithCounts = await Promise.all(
    posts.map(async (post) => {
      const [reactionCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(reactions)
        .where(eq(reactions.postId, post.id));

      // Charger les commentaires
      const postComments = await db
        .select({
          id: comments.id,
          content: comments.content,
          createdAt: comments.createdAt,
          authorId: comments.authorId,
          authorPseudo: user.pseudo,
          authorName: user.name,
          authorAvatarUrl: user.avatarUrl,
        })
        .from(comments)
        .innerJoin(user, eq(comments.authorId, user.id))
        .where(eq(comments.postId, post.id))
        .orderBy(comments.createdAt);

      // L'utilisateur a-t-il liké ce post ?
      const [userReaction] = await db
        .select({ id: reactions.id })
        .from(reactions)
        .where(and(eq(reactions.postId, post.id), eq(reactions.userId, session.user.id)));

      return {
        id: post.id,
        content: post.content,
        imageUrl: post.imageUrl,
        isAnnouncement: post.isAnnouncement,
        createdAt: post.createdAt.toISOString(),
        author: {
          id: post.authorId,
          pseudo: post.authorPseudo || post.authorName,
          avatarUrl: post.authorAvatarUrl,
          role: post.authorRole,
        },
        reactionCount: Number(reactionCount.count),
        commentCount: postComments.length,
        comments: postComments.map((c) => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt.toISOString(),
          author: {
            id: c.authorId,
            pseudo: c.authorPseudo || c.authorName,
            avatarUrl: c.authorAvatarUrl,
          },
        })),
        userHasReacted: !!userReaction,
      };
    }),
  );

  return {
    posts: postsWithCounts,
    currentUserId: session.user.id,
    isAdmin: (session.user as any).role === "admin",
  };
}

export async function feedAction({ request }: { request: Request }) {
  let session;
  try {
    session = await requireAuth(request);
  } catch {
    throw redirect("/connexion");
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-post") {
    const content = formData.get("content") as string;
    const isAnnouncement = formData.get("isAnnouncement") === "on";
    const result = createPostSchema.safeParse({ content });

    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    // Seuls les admins peuvent publier des annonces
    if (isAnnouncement && (session.user as any).role !== "admin") {
      return { error: "Seuls les admins peuvent publier des annonces." };
    }

    await db.insert(feedPosts).values({
      id: createId(),
      authorId: session.user.id,
      content: result.data.content,
      isAnnouncement,
    });

    logger.info({ action: "post-created", userId: session.user.id }, "Post publié");
    evaluateBadges(session.user.id).catch((err) => logger.error({ err, userId: session.user.id }, "Erreur évaluation badges"));
    return { success: true };
  }

  if (intent === "react") {
    const postId = formData.get("postId") as string;

    const [existing] = await db
      .select({ id: reactions.id })
      .from(reactions)
      .where(and(eq(reactions.postId, postId), eq(reactions.userId, session.user.id)));

    if (existing) {
      await db.delete(reactions).where(eq(reactions.id, existing.id));
    } else {
      await db.insert(reactions).values({
        id: createId(),
        postId,
        userId: session.user.id,
      });
      evaluateBadges(session.user.id).catch((err) => logger.error({ err, userId: session.user.id }, "Erreur évaluation badges"));
    }

    return { success: true };
  }

  if (intent === "comment") {
    const postId = formData.get("postId") as string;
    const content = formData.get("content") as string;
    const result = createCommentSchema.safeParse({ postId, content });

    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    await db.insert(comments).values({
      id: createId(),
      postId: result.data.postId,
      authorId: session.user.id,
      content: result.data.content,
    });

    evaluateBadges(session.user.id).catch((err) => logger.error({ err, userId: session.user.id }, "Erreur évaluation badges"));
    return { success: true };
  }

  if (intent === "delete-post") {
    const postId = formData.get("postId") as string;
    const isAdmin = (session.user as any).role === "admin";

    const [post] = await db.select({ authorId: feedPosts.authorId }).from(feedPosts).where(eq(feedPosts.id, postId));
    if (!post) return { error: "Post introuvable." };

    if (post.authorId !== session.user.id && !isAdmin) {
      return { error: "Vous ne pouvez pas supprimer ce post." };
    }

    await db.delete(feedPosts).where(eq(feedPosts.id, postId));
    logger.info({ action: "post-deleted", userId: session.user.id, postId }, "Post supprimé");
    return { success: true };
  }

  if (intent === "delete-comment") {
    const commentId = formData.get("commentId") as string;
    const isAdmin = (session.user as any).role === "admin";

    const [comment] = await db.select({ authorId: comments.authorId }).from(comments).where(eq(comments.id, commentId));
    if (!comment) return { error: "Commentaire introuvable." };

    if (comment.authorId !== session.user.id && !isAdmin) {
      return { error: "Vous ne pouvez pas supprimer ce commentaire." };
    }

    await db.delete(comments).where(eq(comments.id, commentId));
    return { success: true };
  }

  return { error: "Action inconnue." };
}

export async function loadComments(postId: string) {
  return db
    .select({
      id: comments.id,
      content: comments.content,
      createdAt: comments.createdAt,
      authorId: comments.authorId,
      authorPseudo: user.pseudo,
      authorName: user.name,
      authorAvatarUrl: user.avatarUrl,
    })
    .from(comments)
    .innerJoin(user, eq(comments.authorId, user.id))
    .where(eq(comments.postId, postId))
    .orderBy(comments.createdAt);
}
