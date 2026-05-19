"use client";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/hooks/useNotificationPreferences";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPreferences } from "@agora/shared";
import { useEffect, useState } from "react";

const supabase = createClient();

const GROUPS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: "assignments",
    label: "Assignments",
    description: "When an issue is assigned to you.",
  },
  {
    key: "status_changes",
    label: "Status changes",
    description: "When the status of an issue you follow changes.",
  },
  {
    key: "comments",
    label: "Comments",
    description: "New comments on issues you follow.",
  },
  {
    key: "updates",
    label: "Issue updates",
    description: "Edits, label changes, and other updates.",
  },
  {
    key: "agent_activity",
    label: "Agent activity",
    description: "When agents start, finish, or fail tasks.",
  },
];

export default function NotificationsPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setToken(data.session.access_token);
    });
  }, []);

  const { data: prefs, isLoading } = useNotificationPreferences(token);
  const updateMutation = useUpdateNotificationPreferences(token);

  const effective: NotificationPreferences = prefs ?? DEFAULT_NOTIFICATION_PREFS;

  async function toggle(key: keyof NotificationPreferences, enabled: boolean) {
    if (!token) return;
    await updateMutation.mutateAsync({ [key]: { enabled } });
  }

  if (!token) return <div className="p-8 text-gray-400">Not signed in.</div>;
  if (isLoading)
    return (
      <div className="p-8 space-y-4 max-w-xl">
        <Skeleton className="h-7 w-40" />
        <div className="space-y-2 mt-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold mb-1">Notifications</h1>
      <p className="text-sm text-gray-500 mb-6">Choose which events should land in your inbox.</p>
      <ul className="divide-y border rounded">
        {GROUPS.map((g) => {
          const enabled = effective[g.key]?.enabled ?? true;
          return (
            <li key={g.key} className="flex items-center justify-between p-4">
              <div className="pr-4">
                <div className="font-medium text-sm">{g.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{g.description}</div>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <span className="sr-only">Toggle {g.label}</span>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={updateMutation.isPending}
                  onChange={(e) => toggle(g.key, e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>
            </li>
          );
        })}
      </ul>
      {updateMutation.isError && (
        <div className="text-sm text-red-600 mt-3">
          {updateMutation.error instanceof Error
            ? updateMutation.error.message
            : "Failed to update preferences"}
        </div>
      )}
    </div>
  );
}
