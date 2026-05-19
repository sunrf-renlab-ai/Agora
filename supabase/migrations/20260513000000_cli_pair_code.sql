CREATE TABLE "cli_pair_code" (
	"code" text PRIMARY KEY NOT NULL,
	"token" text,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_cli_pair_code_expires_at" ON "cli_pair_code" USING btree ("expires_at");
