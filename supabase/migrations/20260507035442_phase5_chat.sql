ALTER TABLE "chat_message" RENAME COLUMN "session_id" TO "chat_session_id";--> statement-breakpoint
ALTER TABLE "chat_session" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_chat_session_id_chat_session_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_message_session" ON "chat_message" USING btree ("chat_session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_chat_session_workspace" ON "chat_session" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_chat_session_creator" ON "chat_session" USING btree ("creator_id","workspace_id");--> statement-breakpoint
ALTER TABLE "chat_session" DROP COLUMN "unread_since";