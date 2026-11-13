import type { WalletService } from "./wallet";
import type { Entry, Intent } from "../domain/model";
export type WalletState = Awaited<ReturnType<WalletService["load"]>>;
export type WalletPort = Pick<
  WalletService,
  | "initialize"
  | "load"
  | "exportBackup"
  | "reverseEntry"
  | "addReason"
  | "previewRestore"
  | "restoreBackup"
> & {
  mode?: "cloud";
  submit(input: Intent): Promise<Entry | { pending: true }>;
  saveSettings(
    generation: string,
    input: { nickname: string; goalName: string; goalAmount: number },
    expectedRevision?: number,
  ): Promise<void>;
  changeReason(
    generation: string,
    id: string,
    input: { text: string; archived: boolean },
    expectedRevision?: number,
  ): Promise<void>;
};
