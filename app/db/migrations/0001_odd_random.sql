CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"opponent" varchar(100) NOT NULL,
	"competition" varchar(100) NOT NULL,
	"match_date" timestamp NOT NULL,
	"venue" varchar(20) NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"prediction_deadline" timestamp,
	"points_scheme" varchar(20) DEFAULT 'standard',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
