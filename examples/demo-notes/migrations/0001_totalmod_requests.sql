CREATE TABLE "totalmod_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "totalmod_requests_user_created" ON "totalmod_requests" USING btree ("userId","createdAt");