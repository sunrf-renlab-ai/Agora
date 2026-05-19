import { redirect } from "next/navigation";

export default async function SettingsIndex({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/settings/profile`);
}
