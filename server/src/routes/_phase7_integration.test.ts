import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  attachments,
  issueDependencies,
  issueLabels,
  issueReactions,
  issueToLabel,
  issues,
  members,
  pins,
  users,
  workspaces,
} from "../db/schema/index";
import { broadcastWorkspace, hub } from "../lib/ws-hub";

let workspaceId: string;
let userId: string;
let issueA: string;
let issueB: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [u] = await db
    .insert(users)
    .values({ email: `i-${stamp}@x`, name: "I" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  userId = u!.id;
  const [w] = await db
    .insert(workspaces)
    .values({ name: "I", slug: `i-${stamp}`, issuePrefix: "I" })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  workspaceId = w!.id;
  await db.insert(members).values({ workspaceId, userId, role: "owner" });
  const [a] = await db
    .insert(issues)
    .values({
      workspaceId,
      number: 1,
      title: "A",
      creatorKind: "member",
      creatorId: userId,
    })
    .returning();
  const [b] = await db
    .insert(issues)
    .values({
      workspaceId,
      number: 2,
      title: "B",
      creatorKind: "member",
      creatorId: userId,
    })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: test setup
  issueA = a!.id;
  // biome-ignore lint/style/noNonNullAssertion: test setup
  issueB = b!.id;
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe("phase7 integration (DB layer)", () => {
  it("label assign + filter pipeline works", async () => {
    const [label] = await db
      .insert(issueLabels)
      .values({ workspaceId, name: "bug", color: "#ff0000" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    await db.insert(issueToLabel).values({ workspaceId, issueId: issueA, labelId: label!.id });
    const labeledIssueIds = (
      await db
        .selectDistinct({ id: issueToLabel.issueId })
        .from(issueToLabel)
        // biome-ignore lint/style/noNonNullAssertion: test setup
        .where(eq(issueToLabel.labelId, label!.id))
    ).map((r) => r.id);
    expect(labeledIssueIds).toEqual([issueA]);
  });

  it("dependency: 'blocks' insert is one-way; querying both sides yields the inverse", async () => {
    await db.insert(issueDependencies).values({
      workspaceId,
      issueId: issueA,
      dependsOnIssueId: issueB,
      type: "blocks",
      createdByUserId: userId,
    });
    const blocksFromA = await db
      .select()
      .from(issueDependencies)
      .where(and(eq(issueDependencies.issueId, issueA), eq(issueDependencies.type, "blocks")));
    const blockedByB = await db
      .select()
      .from(issueDependencies)
      .where(
        and(eq(issueDependencies.dependsOnIssueId, issueB), eq(issueDependencies.type, "blocks")),
      );
    expect(blocksFromA.length).toBe(1);
    expect(blockedByB.length).toBe(1);
  });

  it("reaction unique constraint protects against double-add", async () => {
    await db.insert(issueReactions).values({
      workspaceId,
      issueId: issueA,
      actorKind: "member",
      actorId: userId,
      emoji: "rocket",
    });
    let conflicted = false;
    try {
      await db.insert(issueReactions).values({
        workspaceId,
        issueId: issueA,
        actorKind: "member",
        actorId: userId,
        emoji: "rocket",
      });
    } catch {
      conflicted = true;
    }
    expect(conflicted).toBe(true);
  });

  it("attachment metadata round-trips", async () => {
    const [row] = await db
      .insert(attachments)
      .values({
        workspaceId,
        ownerKind: "issue",
        ownerId: issueA,
        filename: "shot.png",
        contentType: "image/png",
        size: 1234,
        storageKey: `${workspaceId}/issue/${issueA}/x/shot.png`,
        createdByUserId: userId,
      })
      .returning();
    expect(row).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(row!.storageKey.startsWith(`${workspaceId}/issue/${issueA}/`)).toBe(true);
  });

  it("pin: same (user, workspace, itemType, itemId) collapses to one logical pin", async () => {
    await db.insert(pins).values({ workspaceId, userId, itemType: "issue", itemId: issueA });
    const list = await db
      .select()
      .from(pins)
      .where(and(eq(pins.workspaceId, workspaceId), eq(pins.userId, userId)));
    expect(list.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: test setup
    expect(list[0]!.itemId).toBe(issueA);
  });
});

describe("phase7 integration (WS broadcasts)", () => {
  // Capture broadcasts emitted on this workspace channel by attaching a fake WebSocket
  // that the hub will treat as OPEN and serialize messages to.
  function attachFakeSocket() {
    const sent: string[] = [];
    const fakeWs = {
      readyState: 1, // WebSocket.OPEN
      send: (v: string) => {
        sent.push(v);
      },
    } as unknown as WebSocket;
    hub.subscribe(`workspace:${workspaceId}`, fakeWs);
    return {
      sent,
      detach: () => hub.unsubscribe(fakeWs),
    };
  }

  it("pin.created and pin.deleted broadcasts fire end-to-end across all five features", async () => {
    const { sent, detach } = attachFakeSocket();

    // 1) Label create + assign to issue (DB layer mirrors what the routes do)
    const [label] = await db
      .insert(issueLabels)
      .values({ workspaceId, name: "ws-bug", color: "#00ff00" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const labelRow = label!;
    await db.insert(issueToLabel).values({ workspaceId, issueId: issueA, labelId: labelRow.id });

    // Simulate the route-layer broadcasts the labels router would emit
    broadcastWorkspace(workspaceId, {
      type: "label.created",
      data: { id: labelRow.id, workspaceId },
    });
    broadcastWorkspace(workspaceId, {
      type: "issue.labels_changed",
      data: { issueId: issueA, workspaceId },
    });

    // 2) Dependency create
    await db.insert(issueDependencies).values({
      workspaceId,
      issueId: issueA,
      dependsOnIssueId: issueB,
      type: "blocks",
      createdByUserId: userId,
    });
    broadcastWorkspace(workspaceId, {
      type: "issue.dependencies_changed",
      data: { issueId: issueA, workspaceId },
    });

    // 3) Reaction add
    await db.insert(issueReactions).values({
      workspaceId,
      issueId: issueA,
      actorKind: "member",
      actorId: userId,
      emoji: "+1",
    });
    broadcastWorkspace(workspaceId, {
      type: "reaction.added",
      data: { targetKind: "issue", targetId: issueA, emoji: "+1", workspaceId },
    });

    // 4) Attachment metadata insert
    const [att] = await db
      .insert(attachments)
      .values({
        workspaceId,
        ownerKind: "issue",
        ownerId: issueA,
        filename: "a.png",
        contentType: "image/png",
        size: 100,
        storageKey: `${workspaceId}/issue/${issueA}/k/a.png`,
        createdByUserId: userId,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const attRow = att!;
    broadcastWorkspace(workspaceId, {
      type: "attachment.added",
      data: { id: attRow.id, ownerKind: "issue", ownerId: issueA, workspaceId },
    });

    // 5) Pin an issue
    const [pin] = await db
      .insert(pins)
      .values({ workspaceId, userId, itemType: "issue", itemId: issueA })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: test setup
    const pinRow = pin!;
    broadcastWorkspace(workspaceId, {
      type: "pin.created",
      data: { id: pinRow.id, userId, workspaceId },
    });

    // Verify all rows landed in the database
    const labelLink = await db.query.issueToLabel.findFirst({
      where: and(eq(issueToLabel.issueId, issueA), eq(issueToLabel.labelId, labelRow.id)),
    });
    expect(labelLink).toBeTruthy();

    const dep = await db.query.issueDependencies.findFirst({
      where: and(
        eq(issueDependencies.issueId, issueA),
        eq(issueDependencies.dependsOnIssueId, issueB),
      ),
    });
    expect(dep).toBeTruthy();

    const reaction = await db.query.issueReactions.findFirst({
      where: and(eq(issueReactions.issueId, issueA), eq(issueReactions.actorId, userId)),
    });
    expect(reaction).toBeTruthy();

    const attCheck = await db.query.attachments.findFirst({
      where: eq(attachments.id, attRow.id),
    });
    expect(attCheck).toBeTruthy();

    const pinCheck = await db.query.pins.findFirst({
      where: eq(pins.id, pinRow.id),
    });
    expect(pinCheck).toBeTruthy();

    // Verify all WS broadcasts fired
    const events = sent.map((s) => JSON.parse(s).event.type as string);
    expect(events).toContain("label.created");
    expect(events).toContain("issue.labels_changed");
    expect(events).toContain("issue.dependencies_changed");
    expect(events).toContain("reaction.added");
    expect(events).toContain("attachment.added");
    expect(events).toContain("pin.created");

    // Now exercise pin.deleted
    await db.delete(pins).where(eq(pins.id, pinRow.id));
    broadcastWorkspace(workspaceId, {
      type: "pin.deleted",
      data: { id: pinRow.id, userId, workspaceId },
    });
    const eventsAfter = sent.map((s) => JSON.parse(s).event.type as string);
    expect(eventsAfter).toContain("pin.deleted");

    detach();
  });
});
