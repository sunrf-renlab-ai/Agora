"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export function LocaleSwitcher() {
  const router = useRouter();
  const t = useTranslations("settings");

  function set(loc: string) {
    document.cookie = `agora-locale=${loc};path=/;max-age=31536000`;
    router.refresh();
  }

  return (
    <div>
      <div className="block text-sm font-medium mb-1">{t("language")}</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => set("en")}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100"
        >
          {t("english")}
        </button>
        <button
          type="button"
          onClick={() => set("zh-Hans")}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100"
        >
          {t("chinese")}
        </button>
      </div>
    </div>
  );
}
