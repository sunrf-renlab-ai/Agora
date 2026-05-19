"use client";
import { LocaleSwitcher } from "@/components/settings/LocaleSwitcher";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const supabase = createClient();

interface Me {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export default function ProfilePage() {
  const t = useTranslations("settings");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setLoading(false);
        return;
      }
      const t = data.session.access_token;
      setToken(t);
      try {
        const u = (await api.getMe(t)) as Me;
        setMe(u);
        setName(u.name ?? "");
        setAvatarUrl(u.avatarUrl ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedAvatar = avatarUrl.trim();
      const updated = (await api.updateMe(token, {
        name: name.trim(),
        avatarUrl: trimmedAvatar === "" ? null : trimmedAvatar,
      })) as Me;
      setMe(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <div className="p-8 space-y-4 max-w-xl">
        <Skeleton className="h-7 w-32" />
        <div className="space-y-3 mt-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      </div>
    );
  if (!me) return <div className="p-8 text-gray-400">Not signed in.</div>;

  return (
    <div>
      <PageHeader eyebrow="Settings" title={t("profile")} />
      <form onSubmit={handleSubmit} className="space-y-4 p-8 max-w-xl">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="profile-email">
            {t("email")}
          </label>
          <input
            id="profile-email"
            type="email"
            value={me.email}
            disabled
            className="w-full border rounded px-3 py-2 bg-gray-100 text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="profile-name">
            {t("name")}
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="profile-avatar">
            {t("avatarUrl")}
          </label>
          <input
            id="profile-avatar"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
            className="w-full border rounded px-3 py-2"
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        {savedAt && !error && <div className="text-sm text-green-600">Saved.</div>}
        <button
          type="submit"
          disabled={saving}
          className="bg-indigo-600 text-white rounded px-4 py-2 font-medium disabled:opacity-50"
        >
          {saving ? `${t("save")}…` : t("save")}
        </button>
      </form>
      <div className="mt-8 pt-6 border-t">
        <LocaleSwitcher />
      </div>
    </div>
  );
}
