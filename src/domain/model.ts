export type Category = 'EARN' | 'DEDUCT' | 'SPEND';
export type Kind = Category | 'REVERSAL';
export interface Wallet { id: string; nickname: string; balance: number; lastSequence: number }
export interface Entry { id: string; operationId: string; walletId: string; sequence: number; kind: Kind; amount: number; reasonId: string | null; reasonTextSnapshot: string; note: string; occurredAt: string; createdAt: string; balanceAfter: number; reversesEntryId?: string; intent: string }
export interface Reason { id: string; category: Category; text: string; normalizedText: string; archived: boolean; createdAt: string; updatedAt: string }
export interface Settings { id: string; goalName: string; goalAmount: number; language: 'zh-HK'; timeZone: 'Asia/Hong_Kong' }
export interface Meta { id: string; databaseSchemaVersion: 1; datasetGeneration: string; revision: number }
export interface Backup { appId: 'stamp-wallet'; formatVersion: 1; databaseSchemaVersion: 1; exportedAt: string; wallet: Wallet; entries: Entry[]; reasons: Reason[]; settings: Settings; meta: Meta }
export interface Intent { operationId: string; generation: string; kind: Category; amount: string; reason: string; note: string; occurredAt: string }
export function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function safe(n: number): number { check(Number.isSafeInteger(n) && n >= 0, '數量超出安全範圍或餘額不足'); return n; }
export function positiveInteger(v: string): number { check(/^[0-9]+$/.test(v), '請輸入正整數，不接受小數或科學記號'); const n=Number(v); check(Number.isSafeInteger(n) && n>0, '數量必須為大於 0 的安全整數'); return n; }
export function clean(v: string, max=100, required=true): string { check(typeof v==='string','文字格式不正確'); const s=v.trim().replace(/\s+/gu,' '); check([...s].length<=max, `文字不能超過 ${max} 字元`); check(!required || s.length>0,'請填寫原因／用途'); return s; }
export function iso(v: string): string { check(typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v, '日期時間不正確'); return v; }
export function hkInput(date=new Date()): string {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function hkToUtc(v: string): string { check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v),'請填寫有效使用時間'); const d=new Date(`${v}:00+08:00`); check(Number.isFinite(d.getTime()) && hkInput(d)===v,'日期時間不正確'); return d.toISOString(); }
export const displayTime=(v:string)=>new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(v));
export const labels:Record<Kind,string>={EARN:'加印',DEDUCT:'扣印',SPEND:'消費',REVERSAL:'更正'};
export function replay(entries: Entry[]) {
 let balance=0; let sequence=0; const seen=new Map<string,Entry>(); const operations=new Set<string>(); const reversed=new Set<string>(); const stats:Record<Category,number>={EARN:0,DEDUCT:0,SPEND:0};
 for(const e of [...entries].sort((a,b)=>a.sequence-b.sequence)) {
  check(e.sequence===sequence+1,'入帳次序不完整'); sequence=e.sequence;
  check(!seen.has(e.id) && !operations.has(e.operationId),'交易 ID 或 operationId 重複');
  check(Number.isSafeInteger(e.amount) && e.amount>0,'交易數量不正確');
  let delta:number;
  if(e.kind==='REVERSAL') {
   const original=seen.get(e.reversesEntryId || '');
   check(original && original.kind!=='REVERSAL' && original.walletId===e.walletId && !reversed.has(original.id) && original.amount===e.amount,'更正引用或數量不正確');
   reversed.add(original.id); delta=original.kind==='EARN' ? -e.amount : e.amount;
   stats[original.kind]=safe(stats[original.kind]-e.amount);
  } else {
   check(['EARN','DEDUCT','SPEND'].includes(e.kind) && !e.reversesEntryId,'交易種類不正確');
   check(e.kind==='SPEND' || e.amount===1,'加印／扣印每次必須為 1');
   delta=e.kind==='EARN'?e.amount:-e.amount; stats[e.kind]=safe(stats[e.kind]+e.amount);
  }
  balance=safe(balance+delta); check(e.balanceAfter===balance,'記錄後餘額不一致'); seen.set(e.id,e); operations.add(e.operationId);
 }
 return {balance,lastSequence:sequence,stats,reversed};
}
