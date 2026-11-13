import type { Backup } from "../domain/model";
export interface FamilySnapshot {
  familyId: string;
  role: "owner" | "parent";
  members: { userId: string; label: string; role: "owner" | "parent" }[];
  backup: Backup;
}
export interface CloudTransport {
  userId: string;
  current(): Promise<FamilySnapshot | null>;
  apply(operation: Record<string, unknown>): Promise<FamilySnapshot>;
}
export class CloudError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
