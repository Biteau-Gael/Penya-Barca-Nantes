import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { feedLoader, feedAction } from "./feed.server";

export const loader = feedLoader;
export const action = feedAction;

export function meta() {
  return [{ title: "Fil communautaire — Penya Blaugrana Nantes" }];
}

interface CommentData {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; pseudo: string; avatarUrl: string | null };
}

interface PostData {
  id: string;
  content: string;
  imageUrl: string | null;
  isAnnouncement: boolean;
  createdAt: string;
  author: { id: string; pseudo: string; avatarUrl: string | null; role: string };
  reactionCount: number;
  commentCount: number;
  comments: CommentData[];
  userHasReacted: boolean;
}

interface ActionResult { success?: boolean; error?: string }

export default function Feed() {
  const { posts, currentUserId, isAdmin } = useLoaderData<{
    posts: PostData[];
    currentUserId: string;
    isAdmin: boolean;
  }>();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [commentingPostId, setCommentingPostId] = useState<string | null>(null);
  const [deletePostId, setDeletePostId] = useState<string | null>(null);

  // Annonces épinglées en haut
  const announcements = posts.filter((p) => p.isAnnouncement);
  const regularPosts = posts.filter((p) => !p.isAnnouncement);

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Fil communautaire</h1>

        {actionData?.error && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {actionData.error}
          </div>
        )}

        {/* Formulaire nouveau post */}
        <Card>
          <CardContent className="pt-4">
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="create-post" />
              <textarea
                name="content"
                placeholder="Quoi de neuf, culer ? 🎉"
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[80px] resize-none"
                required
              />
              <div className="flex items-center justify-between">
                <div>
                  {isAdmin && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name="isAnnouncement" className="h-3 w-3" />
                      Annonce officielle
                    </label>
                  )}
                </div>
                <Button type="submit" size="sm" disabled={isSubmitting}>
                  {isSubmitting ? "Publication..." : "Publier"}
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>

        {/* Annonces épinglées */}
        {announcements.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            commentingPostId={commentingPostId}
            setCommentingPostId={setCommentingPostId}
            deletePostId={deletePostId}
            setDeletePostId={setDeletePostId}
            isSubmitting={isSubmitting}
            pinned
          />
        ))}

        {/* Posts réguliers */}
        {regularPosts.length === 0 && announcements.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Aucun post pour le moment.</p>
            <p className="text-xs text-muted-foreground mt-1">Sois le premier à publier !</p>
          </div>
        )}

        {regularPosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            commentingPostId={commentingPostId}
            setCommentingPostId={setCommentingPostId}
            deletePostId={deletePostId}
            setDeletePostId={setDeletePostId}
            isSubmitting={isSubmitting}
          />
        ))}
      </div>
    </main>
  );
}

function PostCard({
  post,
  currentUserId,
  isAdmin,
  commentingPostId,
  setCommentingPostId,
  deletePostId,
  setDeletePostId,
  isSubmitting,
  pinned,
}: {
  post: PostData;
  currentUserId: string;
  isAdmin: boolean;
  commentingPostId: string | null;
  setCommentingPostId: (id: string | null) => void;
  deletePostId: string | null;
  setDeletePostId: (id: string | null) => void;
  isSubmitting: boolean;
  pinned?: boolean;
}) {
  const date = new Date(post.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const canDelete = post.author.id === currentUserId || isAdmin;

  return (
    <Card className={pinned ? "border-accent bg-accent/5" : ""}>
      <CardContent className="pt-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-white font-bold overflow-hidden shrink-0">
            {post.author.avatarUrl ? (
              <img src={post.author.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              post.author.pseudo.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground text-sm truncate">{post.author.pseudo}</p>
              {post.isAnnouncement && (
                <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded font-medium">
                  Annonce
                </span>
              )}
              {post.author.role === "admin" && (
                <span className="text-xs text-primary font-medium">Admin</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{date}</p>
          </div>
          {canDelete && (
            deletePostId === post.id ? (
              <Form method="post" className="flex gap-1">
                <input type="hidden" name="intent" value="delete-post" />
                <input type="hidden" name="postId" value={post.id} />
                <Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>Oui</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDeletePostId(null)}>Non</Button>
              </Form>
            ) : (
              <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={() => setDeletePostId(post.id)}>
                ✕
              </Button>
            )
          )}
        </div>

        {/* Contenu */}
        <p className="text-sm text-foreground whitespace-pre-wrap">{post.content}</p>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-1 border-t border-border">
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="react" />
            <input type="hidden" name="postId" value={post.id} />
            <button
              type="submit"
              className={`text-sm flex items-center gap-1 ${
                post.userHasReacted ? "text-primary font-medium" : "text-muted-foreground hover:text-primary"
              }`}
            >
              ♥ {post.reactionCount > 0 && post.reactionCount}
            </button>
          </Form>

          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setCommentingPostId(commentingPostId === post.id ? null : post.id)}
          >
            💬 {post.commentCount > 0 && post.commentCount}
          </button>
        </div>

        {/* Commentaires */}
        {commentingPostId === post.id && (
          <div className="space-y-3 border-t border-border pt-3">
            {post.comments.length > 0 && (
              <div className="space-y-2">
                {post.comments.map((comment) => {
                  const commentDate = new Date(comment.createdAt).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const canDeleteComment = comment.author.id === currentUserId || isAdmin;

                  return (
                    <div key={comment.id} className="flex gap-2 text-sm">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary/70 text-white text-xs font-bold overflow-hidden shrink-0">
                        {comment.author.avatarUrl ? (
                          <img src={comment.author.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          comment.author.pseudo.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{comment.author.pseudo}</span>
                          <span className="text-xs text-muted-foreground">{commentDate}</span>
                          {canDeleteComment && (
                            <Form method="post" className="inline">
                              <input type="hidden" name="intent" value="delete-comment" />
                              <input type="hidden" name="commentId" value={comment.id} />
                              <button type="submit" className="text-xs text-muted-foreground hover:text-destructive">✕</button>
                            </Form>
                          )}
                        </div>
                        <p className="text-foreground">{comment.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Formulaire commentaire */}
            <Form method="post" className="flex gap-2">
              <input type="hidden" name="intent" value="comment" />
              <input type="hidden" name="postId" value={post.id} />
              <Input
                name="content"
                placeholder="Ton commentaire..."
                className="flex-1"
                required
                autoFocus
              />
              <Button type="submit" size="sm" disabled={isSubmitting}>
                Envoyer
              </Button>
            </Form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
