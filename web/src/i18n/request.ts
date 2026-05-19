import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// Default to en. Users can override to zh-Hans via the agora-locale
// cookie set from settings.
export default getRequestConfig(async () => {
  const c = await cookies();
  const locale = c.get("agora-locale")?.value === "zh-Hans" ? "zh-Hans" : "en";
  return {
    locale,
    messages: (await import(`./${locale}.json`)).default,
  };
});
