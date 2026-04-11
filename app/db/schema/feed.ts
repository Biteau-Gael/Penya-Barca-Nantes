import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { user } from "./users";
import { createId } from "~/lib/utils";

export const feedPosts = pgTable("feed_posts", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  isAnnouncement: boolean("is_announcement").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const comments = pgTable("comments", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  postId: text("post_id")
    .notNull()
    .references(() => feedPosts.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reactions = pgTable("reactions", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  postId: text("post_id")
    .notNull()
    .references(() => feedPosts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("like"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
