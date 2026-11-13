import { check, clean, iso, replay, safe, type Backup, type Category, type Entry, type Kind, type Reason } from '../domain/model';
type Obj=Record<string,unknown>;
const object=(v:unknown):Obj=>{check(v!==null && typeof v==='object' && !Array.isArray(v),'備份物件格式不正確');return v as Obj;};
const string=(v:unknown,max:number,required=true)=>{check(typeof v==='string','備份文字格式不正確');check([...v].length<=max && (!required||v.length>0),'備份文字長度不正確');return v;};
const identifier=(v:unknown)=>string(v,100);
const integer=(v:unknown,positive=false)=>{check(typeof v==='number' && Number.isSafeInteger(v) && v>=(positive?1:0),'備份整數不正確');return v;};
const date=(v:unknown)=>iso(string(v,30));
const array=(v:unknown)=>{check(Array.isArray(v),'備份清單格式不正確');return v;};
export function validateBackup(value:unknown):Backup {
 const b=object(value); check(b.appId==='stamp-wallet' && b.formatVersion===1 && b.databaseSchemaVersion===1,'不支援此備份或版本');
 const w=object(b.wallet),s=object(b.settings),m=object(b.meta);
 check(w.id==='main'&&s.id==='main'&&m.id==='main'&&m.databaseSchemaVersion===1,'戶口或資料版本不正確');
 check(s.language==='zh-HK'&&s.timeZone==='Asia/Hong_Kong','語言或時區不支援');
 const wallet={id:'main',nickname:clean(string(w.nickname,100)),balance:integer(w.balance),lastSequence:integer(w.lastSequence)};
 const settings={id:'main',goalName:clean(string(s.goalName,100)),goalAmount:integer(s.goalAmount,true),language:'zh-HK' as const,timeZone:'Asia/Hong_Kong' as const};
 const meta={id:'main',databaseSchemaVersion:1 as const,datasetGeneration:identifier(m.datasetGeneration),revision:integer(m.revision)};
 const reasonIds=new Map<string,Reason>(); const normalized=new Set<string>();
 const reasons=array(b.reasons).map(v=>{
  const r=object(v); check(['EARN','DEDUCT','SPEND'].includes(String(r.category)),'原因分類不正確');
  const text=string(r.text,100); check(clean(text)===text,'原因文字未正規化'); const normalizedText=string(r.normalizedText,200); check(normalizedText===text.toLocaleLowerCase('zh-HK'),'原因索引不正確'); check(typeof r.archived==='boolean','原因停用值不正確');
  const reason:Reason={id:identifier(r.id),category:r.category as Category,text,normalizedText,archived:r.archived,createdAt:date(r.createdAt),updatedAt:date(r.updatedAt)};
  const key=JSON.stringify([reason.category,normalizedText]); check(!reasonIds.has(reason.id)&&!normalized.has(key),'原因 ID 或文字重複'); reasonIds.set(reason.id,reason);normalized.add(key);return reason;
 });
 const entries:Entry[]=array(b.entries).map(v=>{
  const e=object(v); check(e.walletId==='main'&&['EARN','DEDUCT','SPEND','REVERSAL'].includes(String(e.kind)),'交易戶口或種類不正確'); check(e.reasonId===null||typeof e.reasonId==='string','原因引用不正確');
  const entry:Entry={id:identifier(e.id),operationId:identifier(e.operationId),walletId:'main',sequence:integer(e.sequence,true),kind:e.kind as Kind,amount:integer(e.amount,true),reasonId:e.reasonId===null?null:identifier(e.reasonId),reasonTextSnapshot:string(e.reasonTextSnapshot,100),note:string(e.note,500,false),occurredAt:date(e.occurredAt),createdAt:date(e.createdAt),balanceAfter:integer(e.balanceAfter),intent:string(e.intent,4000)};
  check(clean(entry.reasonTextSnapshot)===entry.reasonTextSnapshot && clean(entry.note,500,false)===entry.note,'交易文字未正規化');
  if(e.reversesEntryId!==undefined) entry.reversesEntryId=identifier(e.reversesEntryId);
  if(entry.kind==='REVERSAL') check(entry.reasonId===null && !!entry.reversesEntryId && entry.note==='' && entry.occurredAt===entry.createdAt,'更正欄位不正確');
  else if(entry.reasonId!==null) check(reasonIds.get(entry.reasonId)?.category===entry.kind,'原因引用不存在或分類不符');
  const fingerprint=entry.kind==='REVERSAL'?JSON.stringify({kind:'REVERSAL',entryId:entry.reversesEntryId,reason:entry.reasonTextSnapshot}):JSON.stringify({kind:entry.kind,amount:entry.amount,reason:entry.reasonTextSnapshot,note:entry.note,occurredAt:entry.occurredAt});
  check(entry.intent===fingerprint,'操作內容不一致'); return entry;
 });
 const result=replay(entries); check(result.balance===wallet.balance && result.lastSequence===wallet.lastSequence,'戶口與歷史餘額不一致'); safe(meta.revision);
 return {appId:'stamp-wallet',formatVersion:1,databaseSchemaVersion:1,exportedAt:date(b.exportedAt),wallet,settings,meta,reasons,entries:entries.sort((a,b)=>a.sequence-b.sequence)};
}
