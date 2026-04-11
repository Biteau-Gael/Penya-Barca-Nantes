CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"event_date" timestamp NOT NULL,
	"location" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
