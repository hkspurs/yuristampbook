import type { Table } from "dexie";
import { WalletDB, WalletService } from "../data/wallet";
import { validateBackup } from "../data/backup";
import {
  check,
  clean,
  iso,
  positiveInteger,
  type Intent,
  type Entry,
  type Category,
} from "../domain/model";
import type { WalletPort } from "../data/port";
import { CloudError, type CloudTransport, type FamilySnapshot } from "./types";
export interface QueuedAward {
  operationId: string;
  input: Intent;
  status: "pending" | "blocked";
  error: string;
  queuedAt: string;
}
interface CachedInfo {
  id: string;
  snapshot: FamilySnapshot;
  lastSynced: string;
}
export class CloudDB extends WalletDB {
  outbox!: Table<QueuedAward, string>;
  cloudInfo!: Table<CachedInfo, string>;
  constructor(name: string) {
    super(name);
    this.version(2).stores({ outbox: "operationId,status", cloudInfo: "id" });
  }
}
export class CloudWallet implements WalletPort {
  readonly mode = "cloud" as const;
  get userId() {
    return this.transport.userId;
  }
  readonly db: CloudDB;
  private cache: WalletService;
  private initialized?: Promise<void>;
  private flushing?: Promise<void>;
  private active = true;
  private mutations = new Map<string, Record<string, unknown>>();
  private listeners = new Set<() => void>();
  status = { syncing: false, error: "" };
  constructor(
    private transport: CloudTransport,
    project: string,
    public family: FamilySnapshot,
    private online = () => navigator.onLine,
  ) {
    this.db = new CloudDB(
      `stamp-wallet-cloud:${encodeURIComponent(project)}:${transport.userId}:${family.familyId}`,
    );
    this.cache = new WalletService(this.db);
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }
  private authorized() {
    check(this.active, "登入已變更，請重新登入");
  }
  private connected() {
    this.authorized();
    check(this.online(), "請連線後再確認此操作");
  }
  initialize() {
    return (this.initialized ??= (async () => {
      if (this.family.backup) await this.accept(this.family);
      await this.cache.load(false);
    })());
  }
  load(initialize = true) {
    return (async () => {
      if (initialize) await this.initialize();
      return this.cache.load(false);
    })();
  }
  async accept(snapshot: FamilySnapshot) {
    this.authorized();
    check(
      snapshot && snapshot.familyId === this.family.familyId,
      "家庭已變更，請重新登入",
    );
    check(
      Array.isArray(snapshot.members) &&
        snapshot.members.some((m) => m.userId === this.transport.userId),
      "你已不是此家庭的成員，請重新登入",
    );
    const backup = validateBackup(snapshot.backup);
    await this.db.transaction(
      "rw",
      [
        this.db.wallets,
        this.db.entries,
        this.db.reasons,
        this.db.settings,
        this.db.meta,
        this.db.cloudInfo,
      ],
      async () => {
        const old = await this.db.meta.get("main");
        if (old && old.revision > backup.meta.revision) return;
        if (old && old.revision === backup.meta.revision) {
          check(
            old.datasetGeneration === backup.meta.datasetGeneration,
            "雲端版本不一致，請重新整理",
          );
        }
        for (const t of [
          this.db.wallets,
          this.db.entries,
          this.db.reasons,
          this.db.settings,
          this.db.meta,
        ])
          await t.clear();
        await this.db.wallets.add(backup.wallet);
        await this.db.entries.bulkAdd(backup.entries);
        await this.db.reasons.bulkAdd(backup.reasons);
        await this.db.settings.add(backup.settings);
        await this.db.meta.add(backup.meta);
        await this.db.cloudInfo.put({
          id: "main",
          snapshot: { ...snapshot, backup },
          lastSynced: new Date().toISOString(),
        });
      },
    );
    const latest = await this.db.cloudInfo.get("main");
    if (latest) this.family = latest.snapshot;
    this.changed();
  }
  async refresh() {
    this.connected();
    this.status = { syncing: true, error: "" };
    this.changed();
    try {
      await this.flush();
      const snapshot = await this.transport.current();
      this.authorized();
      check(snapshot, "家庭不存在或權限已變更");
      await this.accept(snapshot);
    } catch (e) {
      this.status.error = e instanceof Error ? e.message : "同步失敗，請重試";
      throw e;
    } finally {
      this.status.syncing = false;
      this.changed();
    }
  }
  stop() {
    this.active = false;
    this.changed();
  }
  private async generation(generation: string) {
    const state = await this.cache.load(false);
    check(
      state.meta.datasetGeneration === generation,
      "資料已變更，請重新開啟表單",
    );
    return state;
  }
  async submit(input: Intent): Promise<Entry | { pending: true }> {
    this.authorized();
    await this.initialize();
    await this.generation(input.generation);
    check(["EARN", "DEDUCT", "SPEND"].includes(input.kind), "交易種類不正確");
    const amount = positiveInteger(input.amount);
    check(input.kind === "SPEND" || amount === 1, "加印／扣印每次必須為 1");
    const fixed = {
      ...input,
      amount: String(amount),
      reason: clean(input.reason, 100, input.kind !== "EARN") || "獎勵印仔",
      note: clean(input.note, 500, false),
      occurredAt: iso(input.occurredAt),
    };
    clean(input.operationId, 100);
    if (input.kind !== "EARN") {
      this.connected();
      await this.accept(
        await this.transport.apply({
          ...fixed,
          type: fixed.kind,
          kind: undefined,
        }),
      );
      const entry = await this.db.entries
        .where("operationId")
        .equals(fixed.operationId)
        .first();
      check(entry, "已回應但找不到交易，請同步確認，勿重複提交");
      return entry;
    }
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.entries,
      async () => {
        const prior = await this.db.outbox.get(fixed.operationId);
        if (prior) {
          check(
            JSON.stringify(prior.input) === JSON.stringify(fixed),
            "同一操作 ID 的內容不同",
          );
          return;
        }
        const confirmed = await this.db.entries
          .where("operationId")
          .equals(fixed.operationId)
          .first();
        if (confirmed) {
          check(
            confirmed.intent ===
              JSON.stringify({
                kind: fixed.kind,
                amount,
                reason: fixed.reason,
                note: fixed.note,
                occurredAt: fixed.occurredAt,
              }),
            "同一操作 ID 的內容不同",
          );
          return;
        }
        await this.db.outbox.add({
          operationId: fixed.operationId,
          input: fixed,
          status: "pending",
          error: "",
          queuedAt: new Date().toISOString(),
        });
      },
    );
    this.changed();
    if (this.online()) await this.flush();
    if (await this.db.outbox.get(fixed.operationId)) return { pending: true };
    const entry = await this.db.entries
      .where("operationId")
      .equals(fixed.operationId)
      .first();
    check(entry, "請同步以確認這次加印結果");
    return entry;
  }
  private flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      this.status.error = "";
      const queued = await this.db.outbox.toArray();
      for (const item of queued) {
        this.connected();
        if (item.status === "blocked") continue;
        try {
          const result = await this.transport.apply({
            ...item.input,
            type: "EARN",
            kind: undefined,
          });
          this.authorized();
          await this.accept(result);
          await this.db.outbox.delete(item.operationId);
        } catch (e) {
          const error = e instanceof Error ? e.message : "同步失敗";
          this.status.error = error;
          // A lost response must retain the original intent; retrying is safe on the server.
          if (this.active)
            await this.db.outbox.update(item.operationId, {
              status:
                e instanceof CloudError && !e.retryable ? "blocked" : "pending",
              error,
            });
          this.changed();
          break;
        }
      }
    })().finally(() => {
      this.flushing = undefined;
      this.changed();
    });
    return this.flushing;
  }
  async retryBlocked(operationId: string) {
    this.connected();
    await this.db.outbox.update(operationId, { status: "pending", error: "" });
    await this.refresh();
  }
  async dismissBlocked(operationId: string) {
    this.connected();
    const item = await this.db.outbox.get(operationId);
    check(item?.status === "blocked", "未確認結果的項目不可刪除，請先同步");
    await this.db.outbox.delete(operationId);
    this.changed();
  }
  private async mutate(
    type: string,
    generation: string,
    fields: Record<string, unknown>,
    expectedRevision?: number,
  ) {
    this.connected();
    const state = await this.generation(generation);
    const key = JSON.stringify({
      type,
      generation,
      ...fields,
      expectedRevision,
    });
    const operation = this.mutations.get(key) || {
      type,
      generation,
      operationId: crypto.randomUUID(),
      ...fields,
      ...(["SETTINGS", "REASON_UPDATE", "IMPORT"].includes(type)
        ? { expectedRevision: expectedRevision ?? state.meta.revision }
        : {}),
    };
    this.mutations.set(key, operation);
    const result = await this.transport.apply(operation);
    this.authorized();
    await this.accept(result);
    this.mutations.delete(key);
    return operation;
  }
  async reverseEntry(
    generation: string,
    operationId: string,
    entryId: string,
    reason: string,
  ) {
    this.connected();
    await this.generation(generation);
    await this.accept(
      await this.transport.apply({
        type: "REVERSAL",
        generation,
        operationId,
        entryId,
        reason: clean(reason),
      }),
    );
    const entry = await this.db.entries
      .where("operationId")
      .equals(operationId)
      .first();
    check(entry, "請同步以確認撤銷結果");
    return entry;
  }
  async saveSettings(
    generation: string,
    input: { nickname: string; goalName: string; goalAmount: number },
    expectedRevision?: number,
  ) {
    await this.mutate(
      "SETTINGS",
      generation,
      {
        nickname: clean(input.nickname),
        goalName: clean(input.goalName),
        goalAmount: String(positiveInteger(String(input.goalAmount))),
      },
      expectedRevision,
    );
  }
  async addReason(generation: string, category: Category, text: string) {
    await this.mutate("REASON_ADD", generation, {
      category,
      text: clean(text),
    });
    const reason = await this.db.reasons
      .where("[category+normalizedText]")
      .equals([category, clean(text).toLocaleLowerCase("zh-HK")])
      .first();
    check(reason, "請同步以查看新增原因");
    return reason.id;
  }
  async changeReason(
    generation: string,
    reasonId: string,
    input: { text: string; archived: boolean },
    expectedRevision?: number,
  ) {
    await this.mutate(
      "REASON_UPDATE",
      generation,
      { reasonId, text: clean(input.text), archived: input.archived },
      expectedRevision,
    );
  }
  exportBackup() {
    return this.cache.exportBackup();
  }
  async previewRestore(value: unknown) {
    this.connected();
    await this.refresh();
    check(this.family.role === "owner", "只有建立家庭的家長可以匯入");
    check(
      (await this.db.entries.count()) === 0,
      "家庭已有紀錄，不可用本機備份覆蓋",
    );
    check(
      (await this.db.reasons.count()) === 0,
      "家庭已有原因，不可匯入本機備份",
    );
    check((await this.db.outbox.count()) === 0, "請先處理待同步加印");
    return this.cache.previewRestore(value);
  }
  async restoreBackup(
    value: unknown,
    expected: { generation: string; revision: number },
    confirmed: boolean,
    exportedRevision?: number,
  ) {
    this.connected();
    check(confirmed, "請確認已保留備份");
    check(
      exportedRevision === undefined || exportedRevision === expected.revision,
      "資料已變更，請重新預覽及備份",
    );
    check((await this.db.outbox.count()) === 0, "請先處理待同步加印");
    await this.mutate(
      "IMPORT",
      expected.generation,
      { backup: validateBackup(value) },
      expected.revision,
    );
  }
}
