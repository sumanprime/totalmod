CREATE TABLE "notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;