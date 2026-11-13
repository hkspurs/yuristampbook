import { beforeEach, afterEach, it, expect } from "vitest";
import { WalletDB, WalletService } from "../../src/data/wallet";
import { CloudWallet } from "../../src/cloud/wallet";
import {
  CloudError,
  type CloudTransport,
  type FamilySnapshot,
} from "../../src/cloud/types";
let server: WalletService,
  db: WalletDB,
  snapshot: FamilySnapshot,
  client: CloudWallet,
  online: boolean,
  calls: number,
  lost: boolean;
beforeEach(async () => {
  db = new WalletDB("server-" + crypto.randomUUID());
  server = new WalletService(db);
  await server.initialize();
  snapshot = {
    familyId: crypto.randomUUID(),
    role: "owner",
    members: [{ userId: "dad", label: "爸爸", role: "owner" }],
    backup: await server.exportBackup(),
  };
  online = true;
  calls = 0;
  lost = false;
  const transport: CloudTransport = {
    userId: "dad",
    current: async () => ({ ...snapshot, backup: await server.exportBackup() }),
    apply: async (op) => {
      calls++;
      if (!online) throw new CloudError("offline", true);
      await server.submit({
        operationId: String(op.operationId),
        generation: String(op.generation),
        kind: op.type as "EARN",
        amount: String(op.amount),
        reason: String(op.reason),
        note: String(op.note),
        occurredAt: String(op.occurredAt),
      });
      if (lost) {
        lost = false;
        throw new CloudError("回應遺失", true);
      }
      return { ...snapshot, backup: await server.exportBackup() };
    },
  };
  client = new CloudWallet(transport, "test", snapshot, () => online);
  await client.initialize();
});
afterEach(async () => {
  await client.db.delete();
  await db.delete();
});
const earn = () => ({
  operationId: crypto.randomUUID(),
  generation: snapshot.backup.meta.datasetGeneration,
  kind: "EARN" as const,
  amount: "1",
  reason: "做好功課",
  note: "",
  occurredAt: new Date().toISOString(),
});
it("queues offline awards durably without increasing spendable balance", async () => {
  online = false;
  const input = earn();
  expect(await client.submit(input)).toEqual({ pending: true });
  expect((await client.load()).wallet.balance).toBe(0);
  expect(await client.db.outbox.count()).toBe(1);
  expect(calls).toBe(0);
  online = true;
  await client.refresh();
  expect((await client.load()).wallet.balance).toBe(1);
  expect(await client.db.outbox.count()).toBe(0);
});
it("lost response retries identical operation only once on server", async () => {
  lost = true;
  await client.submit(earn());
  expect((await server.load()).wallet.balance).toBe(1);
  expect(await client.db.outbox.count()).toBe(1);
  await client.refresh();
  expect((await client.load()).wallet.balance).toBe(1);
  expect(await db.entries.count()).toBe(1);
  expect(await client.db.outbox.count()).toBe(0);
});
it("offline spending and reversals are rejected before network or queue", async () => {
  online = false;
  await expect(client.submit({ ...earn(), kind: "SPEND" })).rejects.toThrow(
    "連線",
  );
  await expect(
    client.reverseEntry(
      snapshot.backup.meta.datasetGeneration,
      crypto.randomUUID(),
      "missing",
      "更正",
    ),
  ).rejects.toThrow("連線");
  expect(await client.db.outbox.count()).toBe(0);
  expect(calls).toBe(0);
});
it("queue rejects altered retry and retains two deliberate awards", async () => {
  online = false;
  const input = earn();
  await client.submit(input);
  await client.submit(input);
  await expect(
    client.submit({ ...input, reason: "另一原因" }),
  ).rejects.toThrow();
  await client.submit(earn());
  expect(await client.db.outbox.count()).toBe(2);
});
it("stale remote snapshot cannot roll back a newer local confirmed state", async () => {
  const old = structuredClone(snapshot);
  await client.submit(earn());
  await client.accept(old);
  expect((await client.load()).wallet.balance).toBe(1);
  expect(client.family.backup.wallet.balance).toBe(1);
});
it("paused account cannot flush its saved queue", async () => {
  online = false;
  await client.submit(earn());
  online = true;
  client.stop();
  await expect(client.refresh()).rejects.toThrow("登入");
  expect(calls).toBe(0);
  expect(await client.db.outbox.count()).toBe(1);
});
it("family and user caches are isolated and membership mismatch rejected", async () => {
  const other = new CloudWallet(
    {
      userId: "mom",
      current: async () => snapshot,
      apply: async () => snapshot,
    },
    "test",
    {
      ...snapshot,
      members: [
        ...snapshot.members,
        { userId: "mom", label: "媽媽", role: "parent" },
      ],
    },
    () => online,
  );
  expect(other.db.name).not.toBe(client.db.name);
  await expect(
    client.accept({ ...snapshot, familyId: "different" }),
  ).rejects.toThrow();
  other.db.close();
});

it("import preview refuses a family with existing reasons before confirmation", async () => {
  await server.addReason(
    snapshot.backup.meta.datasetGeneration,
    "EARN",
    "閱讀",
  );
  await expect(client.previewRestore(snapshot.backup)).rejects.toThrow(
    "已有原因",
  );
});

it("deletion lock blocks new offline awards across instances and survives refresh", async () => {
  await client.beginDeletion();
  await client.beginDeletion();
  await client.cancelDeletion();
  await client.refresh();
  online = false;
  const second = new CloudWallet(
    {
      userId: "dad",
      current: async () => snapshot,
      apply: async () => snapshot,
    },
    "test",
    snapshot,
    () => false,
  );
  await second.initialize();
  await expect(second.submit(earn())).rejects.toThrow("刪除");
  second.db.close();
  await expect(client.submit(earn())).rejects.toThrow("刪除");
  expect(await client.db.outbox.count()).toBe(0);
  await client.cancelDeletion();
  await client.submit(earn());
  expect(await client.db.outbox.count()).toBe(1);
  await expect(client.beginDeletion()).rejects.toThrow();
});
