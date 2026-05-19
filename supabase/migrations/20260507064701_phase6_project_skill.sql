CREATE TABLE "runtime_local_skill_import_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"skill_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_local_skill_list_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported" boolean DEFAULT true NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_local_skill" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "runtime_local_skill" CASCADE;--> statement-breakpoint
ALTER TABLE "skill" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "skill" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "visibility" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_resource" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "project_resource" ADD COLUMN "resource_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project_resource" ADD COLUMN "resource_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project_resource" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "project_resource" ADD COLUMN "position" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_resource" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "priority" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "lead_type" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "runtime_local_skill_import_request" ADD CONSTRAINT "runtime_local_skill_import_request_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_local_skill_import_request" ADD CONSTRAINT "runtime_local_skill_import_request_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_local_skill_import_request" ADD CONSTRAINT "runtime_local_skill_import_request_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_local_skill_list_request" ADD CONSTRAINT "runtime_local_skill_list_request_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_local_skill_list_request" ADD CONSTRAINT "runtime_local_skill_list_request_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_local_skill_import_runtime" ON "runtime_local_skill_import_request" USING btree ("runtime_id","status");--> statement-breakpoint
CREATE INDEX "idx_local_skill_list_runtime" ON "runtime_local_skill_list_request" USING btree ("runtime_id","status");--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resource" ADD CONSTRAINT "project_resource_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resource" ADD CONSTRAINT "project_resource_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resource" ADD CONSTRAINT "project_resource_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_skill_file_path" ON "skill_file" USING btree ("skill_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_skill_workspace_name" ON "skill" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "idx_skill_owner" ON "skill" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_project_resource_project" ON "project_resource" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_resource_ref" ON "project_resource" USING btree ("project_id","resource_type","resource_ref");--> statement-breakpoint
CREATE INDEX "idx_project_workspace" ON "project" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "skill" DROP COLUMN "created_by_user_id";--> statement-breakpoint
ALTER TABLE "project_resource" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "project_resource" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "project_resource" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "identifier";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "lead_member_id";