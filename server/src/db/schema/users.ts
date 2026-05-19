import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  supabaseUserId: uuid("supabase_user_id").unique(),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  avatarUrl: text("avatar_url"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  onboardingQuestionnaire: jsonb("onboarding_questionnaire").notNull().default({}),
  notificationPreferences: jsonb("notification_preferences").notNull().default({}),
  starterContentState: text("starter_content_state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
