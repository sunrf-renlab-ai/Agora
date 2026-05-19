"use client";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";

/**
 * /my-issues redirects to /issues?view=my for the same workspace.
 * The Issues page is responsible for filtering by current user when view=my.
 */
export default function MyIssuesRedirectPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${workspaceSlug}/issues?view=my`);
  }, [router, workspaceSlug]);

  return null;
}
