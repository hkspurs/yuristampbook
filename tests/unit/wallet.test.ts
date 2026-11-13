import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WalletDB, WalletService } from "../../src/data/wallet";
import { positiveInteger, hkToUtc } from "../../src/domain/model";
let db: WalletDB, service: WalletService, generation: string;
const intent = (
  kind: "EARN" | "DEDUCT" | "SPEND",
  amount = "1",
  reason = "測試",
) => ({
  operationId: crypto.randomUUID(),
  generation,
  kind,
  amount,
  reason,
  note: "",
  occurredAt: new Date().toISOString(),
});
beforeEach(async () => {
  db = new WalletDB(`test-${crypto.randomUUID()}`);
  service = new WalletService(db);
  generation = (await service.load()).meta.datasetGeneration;
});
afterEach(async () => {
  await db.delete();
});
describe("atomic ledger", () => {
  it("starts empty; +1 +1 -1 spend1 persists zero", async () => {
    expect((await service.load()).wallet.balance).toBe(0);
    await service.submit(intent("EARN"));
    await service.submit(intent("EARN"));
    await service.submit(intent("DEDUCT"));
    await service.submit(intent("SPEND"));
    expect((await service.load()).wallet.balance).toBe(0);
    expect(await db.entries.count()).toBe(4);
  });
  it("rejects zero-balance deduction without orphan reason", async () => {
    await expect(service.submit(intent("DEDUCT"))).rejects.toThrow();
    expect(await db.entries.count()).toBe(0);
    expect(await db.reasons.count()).toBe(0);
  });
  it("12 - 8 = 4, net spending is amount; reject 5 then spend 4", async () => {
    for (let i = 0; i < 12; i++) await service.submit(intent("EARN"));
    await service.submit(intent("SPEND", "8"));
    expect((await service.load()).stats.SPEND).toBe(8);
    await expect(service.submit(intent("SPEND", "5", "孤立"))).rejects.toThrow(
      "差 1",
    );
    expect((await service.load()).wallet.balance).toBe(4);
    expect(await db.entries.count()).toBe(13);
    await service.submit(intent("SPEND", "4"));
    expect((await service.load()).wallet.balance).toBe(0);
  });
  it("idempotent retry rejects changed content, intentional duplicate is separate", async () => {
    const i = intent("EARN");
    await service.submit(i);
    await service.submit(i);
    await expect(service.submit({ ...i, reason: "不同" })).rejects.toThrow();
    await service.submit(intent("EARN"));
    expect(await db.entries.count()).toBe(2);
  });
  it("two DB instances cannot spend the same stamp", async () => {
    await service.submit(intent("EARN"));
    const other = new WalletDB(db.name);
    const s2 = new WalletService(other);
    const result = await Promise.allSettled([
      service.submit(intent("SPEND")),
      s2.submit(intent("SPEND")),
    ]);
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await service.load()).wallet.balance).toBe(0);
    other.close();
  });
  it("transaction failure rolls back reason, entry, wallet and revision", async () => {
    const before = await service.exportBackup();
    const hook = () => {
      throw new Error("injected failure");
    };
    db.entries.hook("creating", hook);
    await expect(service.submit(intent("EARN"))).rejects.toThrow();
    db.entries.hook("creating").unsubscribe(hook);
    const after = await service.exportBackup();
    expect({ ...after, exportedAt: "" }).toEqual({ ...before, exportedAt: "" });
  });
  it("reason rename/archive leaves snapshots; duplicate reactivates", async () => {
    const e = await service.submit(intent("EARN", "1", "  自己   收拾 "));
    await service.changeReason(generation, e.reasonId!, {
      text: "收拾玩具",
      archived: true,
    });
    expect((await db.entries.get(e.id))?.reasonTextSnapshot).toBe("自己 收拾");
    await service.submit(intent("EARN", "1", "收拾玩具"));
    expect((await db.reasons.get(e.reasonId!))?.archived).toBe(false);
    expect(await db.reasons.count()).toBe(1);
  });
  it("full refund, no double reversal nor reversal of reversal", async () => {
    for (let i = 0; i < 8; i++) await service.submit(intent("EARN"));
    const e = await service.submit(intent("SPEND", "8"));
    const r = await service.reverseEntry(
      generation,
      crypto.randomUUID(),
      e.id,
      "家長誤操作更正",
    );
    expect((await service.load()).wallet.balance).toBe(8);
    expect((await service.load()).stats.SPEND).toBe(0);
    await expect(
      service.reverseEntry(generation, crypto.randomUUID(), e.id, "更正"),
    ).rejects.toThrow();
    await expect(
      service.reverseEntry(generation, crypto.randomUUID(), r.id, "更正"),
    ).rejects.toThrow();
  });
  it("cannot reverse spent award until spending is reversed", async () => {
    const e = await service.submit(intent("EARN"));
    const s = await service.submit(intent("SPEND"));
    await expect(
      service.reverseEntry(generation, crypto.randomUUID(), e.id, "更正"),
    ).rejects.toThrow();
    await service.reverseEntry(generation, crypto.randomUUID(), s.id, "更正");
    await service.reverseEntry(generation, crypto.randomUUID(), e.id, "更正");
    expect((await service.load()).wallet.balance).toBe(0);
  });
  it("backdated entries keep sequence and target changes keep balance", async () => {
    await service.submit(intent("EARN"));
    await service.submit({
      ...intent("EARN"),
      occurredAt: "2020-01-01T00:00:00.000Z",
    });
    await service.saveSettings(generation, {
      nickname: "星星",
      goalName: "玩具",
      goalAmount: 1,
    });
    const state = await service.load();
    expect(state.wallet.balance).toBe(2);
    expect(state.entries.map((e) => e.sequence)).toEqual([2, 1]);
  });
});
describe("input", () => {
  it.each([
    "0",
    "-1",
    "1.1",
    "",
    " ",
    "1e2",
    "9007199254740992",
    "NaN",
    "Infinity",
  ])("rejects %s", (v) => expect(() => positiveInteger(v)).toThrow());
  it("validates HK dates without device timezone", () => {
    expect(hkToUtc("2026-11-13T09:30")).toBe("2026-11-13T01:30:00.000Z");
    expect(() => hkToUtc("2026-02-30T12:00")).toThrow();
  });
});
describe("backup and recovery", () => {
  it("round trips all persistent data and statistics; rejects stale generation", async () => {
    await service.submit(intent("EARN"));
    await service.addReason(generation, "SPEND", "雪糕");
    await service.saveSettings(generation, {
      nickname: "太空人",
      goalName: "旅行",
      goalAmount: 27,
    });
    const backup = await service.exportBackup();
    const preview = await service.previewRestore(backup);
    await service.submit(intent("EARN"));
    await expect(
      service.restoreBackup(backup, preview.expected, true),
    ).rejects.toThrow("資料已變更");
    const fresh = await service.previewRestore(backup);
    await service.restoreBackup(backup, fresh.expected, true);
    const restored = await service.exportBackup();
    expect(restored.entries).toEqual(backup.entries);
    expect(restored.reasons).toEqual(backup.reasons);
    expect(restored.settings).toEqual(backup.settings);
    expect(restored.wallet).toEqual(backup.wallet);
    await expect(service.submit(intent("EARN"))).rejects.toThrow("重新載入");
  });
  it("settings change immediately before restore blocks replacement", async () => {
    const backup = await service.exportBackup();
    const p = await service.previewRestore(backup);
    await service.saveSettings(generation, {
      nickname: "最新",
      goalName: "新",
      goalAmount: 20,
    });
    await expect(
      service.restoreBackup(backup, p.expected, true),
    ).rejects.toThrow();
    expect((await service.load()).wallet.nickname).toBe("最新");
  });
  it("old export revision cannot confirm a new preview", async () => {
    const old = await service.exportBackup();
    await service.submit(intent("EARN"));
    const p = await service.previewRestore(old);
    await expect(
      service.restoreBackup(old, p.expected, true, old.meta.revision),
    ).rejects.toThrow();
  });
  it("restore transaction failure preserves complete original data", async () => {
    await service.submit(intent("EARN"));
    const b = await service.exportBackup();
    const p = await service.previewRestore(b);
    const fail = () => {
      throw Error("disk full");
    };
    db.reasons.hook("creating", fail);
    await expect(service.restoreBackup(b, p.expected, true)).rejects.toThrow();
    db.reasons.hook("creating").unsubscribe(fail);
    const after = await service.exportBackup();
    expect({ ...after, exportedAt: "" }).toEqual({ ...b, exportedAt: "" });
  });
  it("rejects malformed backups without changing original", async () => {
    await service.submit(intent("EARN"));
    await service.submit(intent("EARN"));
    const b = await service.exportBackup();
    const mutations: ((x: typeof b) => void)[] = [
      (x) => {
        x.formatVersion = 99 as 1;
      },
      (x) => {
        x.entries[1].id = x.entries[0].id;
      },
      (x) => {
        x.entries[1].reasonId = "missing";
      },
      (x) => {
        x.entries[0].amount = 2;
      },
      (x) => {
        x.wallet.balance = 12;
      },
      (x) => {
        x.entries[1].operationId = x.entries[0].operationId;
      },
      (x) => {
        x.entries[0].occurredAt = "invalid";
      },
      (x) => {
        x.entries[0].sequence = 5;
      },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(b);
      mutate(bad);
      await expect(service.previewRestore(bad)).rejects.toThrow();
    }
    await expect(service.previewRestore("broken")).rejects.toThrow();
    expect((await service.load()).wallet.balance).toBe(2);
  });
  it("rejects future reversal and negative intermediate balance even if final is zero", async () => {
    const e = await service.submit(intent("EARN"));
    await service.reverseEntry(generation, crypto.randomUUID(), e.id, "更正");
    const b = await service.exportBackup();
    [b.entries[0].sequence, b.entries[1].sequence] = [2, 1];
    await expect(service.previewRestore(b)).rejects.toThrow();
    const n = await service.exportBackup();
    n.entries[0].kind = "SPEND";
    n.entries[0].intent = JSON.stringify({
      kind: "SPEND",
      amount: 1,
      reason: n.entries[0].reasonTextSnapshot,
      note: "",
      occurredAt: n.entries[0].occurredAt,
    });
    n.reasons[0].category = "SPEND";
    n.entries[0].balanceAfter = -1;
    await expect(service.previewRestore(n)).rejects.toThrow();
  });
  it("startup detects corruption and retains rescue export", async () => {
    await service.submit(intent("EARN"));
    await db.wallets.update("main", { balance: 20 });
    await expect(service.load()).rejects.toThrow("不一致");
    await expect(service.submit(intent("EARN"))).rejects.toThrow();
    expect((await service.exportBackup()).entries).toHaveLength(1);
  });
  it("script-like text is preserved as plain strings", async () => {
    const e = await service.submit(
      intent("EARN", "1", "<script>alert(1)</script>"),
    );
    expect(e.reasonTextSnapshot).toBe("<script>alert(1)</script>");
    expect(
      (await service.previewRestore(await service.exportBackup())).backup
        .entries[0].reasonTextSnapshot,
    ).toBe(e.reasonTextSnapshot);
  });
});
it("read-only live query can load without opening write transactions", async () => {
  const { liveQuery } = await import("dexie");
  await new Promise<void>((resolve, reject) => {
    const sub = liveQuery(() => service.load(false)).subscribe({
      next: () => {
        sub.unsubscribe();
        resolve();
      },
      error: reject,
    });
  });
});
it('clock moving backwards never reorders the ledger', async () => {
  vi.useFakeTimers({toFake:['Date']});
  try {
    vi.setSystemTime(new Date('2026-11-13T12:00:00.000Z'));
    const first=await service.submit(intent('EARN'));
    vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
    const second=await service.submit(intent('EARN'));
    expect(second.sequence).toBe(first.sequence+1);
    expect(second.createdAt<first.createdAt).toBe(true);
    expect((await service.load()).wallet.balance).toBe(2);
  } finally {vi.useRealTimers();}
});
it('27 stamps survive a ten-stamp target and target edits',async()=>{
  for(let i=0;i<27;i++)await service.submit(intent('EARN'));
  await service.saveSettings(generation,{nickname:'星星',goalName:'新目標',goalAmount:10});
  const s=await service.load();expect(s.wallet.balance).toBe(27);expect(s.stats.EARN).toBe(27);expect(s.entries).toHaveLength(27);
});
it('rejects wrong refund amount, reversal of reversal and category mismatch in backups',async()=>{
  const original=await service.submit(intent('EARN'));
  await service.reverseEntry(generation,crypto.randomUUID(),original.id,'更正');
  const backup=await service.exportBackup();
  const wrongAmount=structuredClone(backup);wrongAmount.entries[1].amount=2;
  await expect(service.previewRestore(wrongAmount)).rejects.toThrow();
  const self=structuredClone(backup);self.entries[1].reversesEntryId=self.entries[1].id;self.entries[1].intent=JSON.stringify({kind:'REVERSAL',entryId:self.entries[1].id,reason:'更正'});
  await expect(service.previewRestore(self)).rejects.toThrow();
  const category=structuredClone(backup);category.reasons[0].category='DEDUCT';
  await expect(service.previewRestore(category)).rejects.toThrow();
});
it('replays every intermediate balance, not just a zero final sum',async()=>{
  await service.submit(intent('EARN'));
  await service.submit(intent('SPEND'));
  const backup=await service.exportBackup();
  backup.entries[0].sequence=2;
  backup.entries[1].sequence=1;
  await expect(service.previewRestore(backup)).rejects.toThrow('餘額不足');
  expect((await service.load()).wallet.balance).toBe(0);
});
