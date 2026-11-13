import Dexie, { type Table } from 'dexie';
import { check, clean, iso, positiveInteger, replay, safe, type Backup, type Category, type Entry, type Intent, type Meta, type Reason, type Settings, type Wallet } from '../domain/model';
import { validateBackup } from './backup';
export class WalletDB extends Dexie {
 wallets!: Table<Wallet,string>; entries!: Table<Entry,string>; reasons!: Table<Reason,string>; settings!: Table<Settings,string>; meta!: Table<Meta,string>;
 constructor(name='stamp-wallet') { super(name); this.version(1).stores({ wallets:'id', entries:'id,&operationId,&sequence,&reversesEntryId,kind', reasons:'id,&[category+normalizedText],category',settings:'id',meta:'id' }); }
}
const id=()=>crypto.randomUUID();
export class WalletService {
 constructor(public db: WalletDB) {}
 private tables() { return [this.db.wallets,this.db.entries,this.db.reasons,this.db.settings,this.db.meta]; }
 async initialize() {
  await this.db.transaction('rw',this.tables(),async()=>{
   if(await this.db.meta.get('main')) return;
   check((await Promise.all(this.tables().map(t=>t.count()))).every(n=>n===0),'資料不完整，請先匯出並還原備份');
   await this.db.wallets.add({id:'main',nickname:'小星星',balance:0,lastSequence:0});
   await this.db.settings.add({id:'main',goalName:'小小心願',goalAmount:10,language:'zh-HK',timeZone:'Asia/Hong_Kong'});
   await this.db.meta.add({id:'main',databaseSchemaVersion:1,datasetGeneration:id(),revision:0});
  });
 }
 async exportBackup():Promise<Backup> {
  return this.db.transaction('r',this.tables(),async()=>({appId:'stamp-wallet',formatVersion:1,databaseSchemaVersion:1,exportedAt:new Date().toISOString(),wallet:(await this.db.wallets.get('main'))!,entries:await this.db.entries.orderBy('sequence').toArray(),reasons:await this.db.reasons.toArray(),settings:(await this.db.settings.get('main'))!,meta:(await this.db.meta.get('main'))!}));
 }
 async load(initialize=true) { if(initialize) await this.initialize(); const data=validateBackup(await this.exportBackup()); const result=replay(data.entries); return {...data,entries:data.entries.slice().reverse(),stats:result.stats,reversed:result.reversed}; }
 private async current(generation:string) {
  const data=validateBackup(await this.exportBackup());
  check(data.meta.datasetGeneration===generation,'資料已還原，請重新載入後再操作'); return data;
 }
 private async bump(meta:Meta) { await this.db.meta.put({...meta,revision:safe(meta.revision+1)}); }
 private async reason(category:Category,text:string) {
  const normalizedText=text.toLocaleLowerCase('zh-HK');
  const existing=await this.db.reasons.where('[category+normalizedText]').equals([category,normalizedText]).first();
  const now=new Date().toISOString();
  if(existing) { if(existing.archived) await this.db.reasons.update(existing.id,{archived:false,updatedAt:now}); return existing.id; }
  const reason:Reason={id:id(),category,text,normalizedText,archived:false,createdAt:now,updatedAt:now}; await this.db.reasons.add(reason); return reason.id;
 }
 async submit(input:Intent):Promise<Entry> {
  const kind=input.kind; check(['EARN','DEDUCT','SPEND'].includes(kind),'交易種類不正確');
  const amount=positiveInteger(input.amount); check(kind==='SPEND'||amount===1,'加印／扣印每次必須為 1');
  const reason=clean(input.reason,100,kind!=='EARN') || '獎勵印仔'; const note=clean(input.note,500,false); const occurredAt=iso(input.occurredAt);
  const operationId=clean(input.operationId,100); const fingerprint=JSON.stringify({kind,amount,reason,note,occurredAt});
  return this.db.transaction('rw',this.tables(),async()=>{
   const data=await this.current(input.generation);
   const prior=await this.db.entries.where('operationId').equals(operationId).first();
   if(prior) { check(prior.intent===fingerprint,'同一操作 ID 的內容不同，請重新開始'); return prior; }
   const balance=data.wallet.balance+(kind==='EARN'?amount:-amount);
   check(balance>=0, kind==='DEDUCT'?'目前沒有可扣的印仔':`印仔不足，還差 ${amount-data.wallet.balance} 個`); safe(balance);
   const reasonId=await this.reason(kind,reason);
   const entry:Entry={id:id(),operationId,walletId:'main',sequence:safe(data.wallet.lastSequence+1),kind,amount,reasonId,reasonTextSnapshot:reason,note,occurredAt,createdAt:new Date().toISOString(),balanceAfter:balance,intent:fingerprint};
   await this.db.entries.add(entry); await this.db.wallets.put({...data.wallet,balance,lastSequence:entry.sequence}); await this.bump(data.meta); return entry;
  });
 }
 awardStamp(input:Omit<Intent,'kind'|'amount'>) { return this.submit({...input,kind:'EARN',amount:'1'}); }
 deductStamp(input:Omit<Intent,'kind'|'amount'>) { return this.submit({...input,kind:'DEDUCT',amount:'1'}); }
 spendStamps(input:Omit<Intent,'kind'>) { return this.submit({...input,kind:'SPEND'}); }
 async reverseEntry(generation:string,operationId:string,entryId:string,reason:string):Promise<Entry> {
  const reasonTextSnapshot=clean(reason); clean(operationId,100);
  const fingerprint=JSON.stringify({kind:'REVERSAL',entryId,reason:reasonTextSnapshot});
  return this.db.transaction('rw',this.tables(),async()=>{
   const data=await this.current(generation); const prior=await this.db.entries.where('operationId').equals(operationId).first();
   if(prior) { check(prior.intent===fingerprint,'同一操作 ID 的內容不同'); return prior; }
   const original=await this.db.entries.get(entryId);
   check(original && original.kind!=='REVERSAL','不能撤銷更正或不存在的紀錄');
   check(!(await this.db.entries.where('reversesEntryId').equals(entryId).first()),'這筆紀錄已撤銷');
   const balance=data.wallet.balance+(original.kind==='EARN'?-original.amount:original.amount);
   check(balance>=0,'印仔已使用，請先更正相關消費／扣減'); safe(balance);
   const now=new Date().toISOString();
   const entry:Entry={id:id(),operationId,walletId:'main',sequence:safe(data.wallet.lastSequence+1),kind:'REVERSAL',amount:original.amount,reasonId:null,reasonTextSnapshot,note:'',occurredAt:now,createdAt:now,balanceAfter:balance,reversesEntryId:entryId,intent:fingerprint};
   await this.db.entries.add(entry); await this.db.wallets.put({...data.wallet,balance,lastSequence:entry.sequence}); await this.bump(data.meta); return entry;
  });
 }
 async saveSettings(generation:string,input:{nickname:string;goalName:string;goalAmount:number}) {
  const nickname=clean(input.nickname,100); const goalName=clean(input.goalName,100); const goalAmount=positiveInteger(String(input.goalAmount));
  await this.db.transaction('rw',this.tables(),async()=>{const data=await this.current(generation); await this.db.wallets.put({...data.wallet,nickname}); await this.db.settings.put({...data.settings,goalName,goalAmount}); await this.bump(data.meta);});
 }
 async addReason(generation:string,category:Category,text:string) {
  check(['EARN','DEDUCT','SPEND'].includes(category),'原因分類不正確'); text=clean(text);
  return this.db.transaction('rw',this.tables(),async()=>{ const data=await this.current(generation); const result=await this.reason(category,text); await this.bump(data.meta); return result; });
 }
 async changeReason(generation:string,reasonId:string,input:{text:string;archived:boolean}) {
  const text=clean(input.text); check(typeof input.archived==='boolean','停用設定不正確');
  await this.db.transaction('rw',this.tables(),async()=>{const data=await this.current(generation); const reason=await this.db.reasons.get(reasonId); check(reason,'原因不存在'); const normalizedText=text.toLocaleLowerCase('zh-HK'); const duplicate=await this.db.reasons.where('[category+normalizedText]').equals([reason.category,normalizedText]).first(); check(!duplicate||duplicate.id===reasonId,'同類別已有此文字，請使用已有項目'); await this.db.reasons.put({...reason,text,normalizedText,archived:input.archived,updatedAt:new Date().toISOString()}); await this.bump(data.meta);});
 }
 async previewRestore(value:unknown) { const backup=validateBackup(value); const current=await this.exportBackup(); check(current.meta,'目前資料缺少 meta，請先保留救援匯出'); return {backup,expected:{generation:current.meta.datasetGeneration,revision:current.meta.revision}}; }
 async restoreBackup(value:unknown,expected:{generation:string;revision:number},confirmed:boolean,exportedRevision?:number) {
  check(confirmed,'請確認已保留所需備份'); const backup=validateBackup(value);
  await this.db.transaction('rw',this.tables(),async()=>{
   const meta=await this.db.meta.get('main'); check(meta && meta.datasetGeneration===expected.generation && meta.revision===expected.revision && (exportedRevision===undefined||exportedRevision===meta.revision),'資料已變更，請重新預覽、匯出最新備份及確認');
   for(const table of this.tables()) await table.clear();
   await this.db.wallets.add(backup.wallet); await this.db.settings.add(backup.settings); await this.db.entries.bulkAdd(backup.entries); await this.db.reasons.bulkAdd(backup.reasons); await this.db.meta.add({id:'main',databaseSchemaVersion:1,datasetGeneration:id(),revision:safe(meta.revision+1)});
  });
 }
}
