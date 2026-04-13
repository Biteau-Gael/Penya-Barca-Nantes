CREATE TABLE "badges" (
	"id" text PRIMARY KEY NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"icon" varchar(50) NOT NULL,
	"condition" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "badges_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "micro_prediction_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"micro_prediction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"answer" text NOT NULL,
	"points" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "micro_predictions" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"question" text NOT NULL,
	"type" varchar(20) NOT NULL,
	"options" text,
	"correct_answer" text,
	"points_value" integer DEFAULT 1 NOT NULL,
	"deadline_seconds" integer DEFAULT 120 NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"streak_count" integer NOT NULL,
	"match_id" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"label" varchar(20) NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"badge_id" text NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "season" varchar(20);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "current_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "best_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "micro_prediction_answers" ADD CONSTRAINT "micro_prediction_answers_micro_prediction_id_micro_predictions_id_fk" FOREIGN KEY ("micro_prediction_id") REFERENCES "public"."micro_predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "micro_prediction_answers" ADD CONSTRAINT "micro_prediction_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "micro_predictions" ADD CONSTRAINT "micro_predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE cascade ON UPDATE no action;