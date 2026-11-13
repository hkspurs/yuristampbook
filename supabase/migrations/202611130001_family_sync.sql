begin;
-- All application writes go through authenticated RPCs. A family row is the lock
-- boundary for the small append-only ledger; clients never write its balance.
create schema if not exists stamp_private;
revoke all on schema stamp_private from public, anon, authenticated;
-- Match JavaScript toLocaleLowerCase('zh-HK'), including contextual Unicode casing.
create collation stamp_private.reason_locale (provider=icu, locale='zh-HK');

create table stamp_private.families (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 data jsonb not null,
 imported boolean not null default false
);
create table stamp_private.members (
 user_id uuid primary key,
 family_id uuid not null references stamp_private.families(id),
 label text not null,
 role text not null check (role in ('owner','parent'))
);
create table stamp_private.operations (
 family_id uuid not null references stamp_private.families(id),
 operation_id text not null,
 actor_id uuid not null,
 payload jsonb not null,
 primary key(family_id,operation_id)
);
create table stamp_private.invites (
 token_hash text primary key,
 family_id uuid not null references stamp_private.families(id),
 expires_at timestamptz not null,
 consumed_by uuid,
 created_at timestamptz not null default now()
);
alter table stamp_private.families enable row level security;
alter table stamp_private.members enable row level security;
alter table stamp_private.operations enable row level security;
alter table stamp_private.invites enable row level security;
revoke all on all tables in schema stamp_private from public, anon, authenticated;

create function stamp_private.assert_true(ok boolean, message text) returns void
language plpgsql set search_path='' as $$
begin if ok is distinct from true then raise exception '%', message using errcode='P0001'; end if; end $$;

create function stamp_private.str(v jsonb, maximum integer, required boolean default true) returns text
language plpgsql immutable set search_path='' as $$
declare result text;
begin
 perform stamp_private.assert_true(jsonb_typeof(v)='string','文字格式不正確');
 result=v#>>'{}';
 perform stamp_private.assert_true(char_length(result)<=maximum and (not required or char_length(result)>0),'文字長度不正確');
 return result;
end $$;

create function stamp_private.clean(v jsonb, maximum integer default 100, required boolean default true) returns text
language plpgsql immutable set search_path='' as $$
declare result text; whites text;
begin
 perform stamp_private.assert_true(jsonb_typeof(v)='string','文字格式不正確');
 whites=chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
 result=btrim(regexp_replace(translate(v#>>'{}',whites,repeat(' ',char_length(whites))),'[[:space:]]+',' ','g'));
 perform stamp_private.assert_true(char_length(result)<=maximum and (not required or char_length(result)>0),'請填寫文字，原因最多100字、備註最多500字');
 return result;
end $$;

create function stamp_private.num(v jsonb, minimum bigint default 0) returns bigint
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 perform stamp_private.assert_true(jsonb_typeof(v)='number','整數格式不正確');
 n=(v#>>'{}')::numeric;
 perform stamp_private.assert_true(n=trunc(n) and n>=minimum and n<=9007199254740991,'數量超出安全整數範圍');
 return n::bigint;
end $$;

create function stamp_private.amount(v jsonb) returns bigint
language plpgsql immutable set search_path='' as $$
declare value text;
begin
 value=stamp_private.str(v,1000);
 perform stamp_private.assert_true(value ~ '^[0-9]+$','請輸入正整數，不接受小數或科學記號');
 return stamp_private.num(to_jsonb(value::numeric),1);
end $$;

create function stamp_private.iso_now() returns text
language sql stable set search_path='' as $$
 select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;
create function stamp_private.iso(v jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare result text; parsed timestamptz;
begin
 result=stamp_private.str(v,30);
 perform stamp_private.assert_true(result ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$','日期時間不正確');
 parsed=result::timestamptz;
 perform stamp_private.assert_true(to_char(parsed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=result,'日期時間不正確');
 return result;
end $$;

-- JSON.stringify order is part of the v1 backup contract.
create function stamp_private.fingerprint(e jsonb) returns text
language sql immutable set search_path='' as $$
 select case when e->>'kind'='REVERSAL' then
 '{"kind":"REVERSAL","entryId":'||(e->'reversesEntryId')::text||',"reason":'||(e->'reasonTextSnapshot')::text||'}'
 else '{"kind":'||(e->'kind')::text||',"amount":'||(e->'amount')::text||',"reason":'||(e->'reasonTextSnapshot')::text||',"note":'||(e->'note')::text||',"occurredAt":'||(e->'occurredAt')::text||'}' end;
$$;

create function stamp_private.empty_backup() returns jsonb
language sql volatile set search_path='' as $$
 select jsonb_build_object('appId','stamp-wallet','formatVersion',1,'databaseSchemaVersion',1,'exportedAt',stamp_private.iso_now(),
 'wallet',jsonb_build_object('id','main','nickname','小星星','balance',0,'lastSequence',0),
 'settings',jsonb_build_object('id','main','goalName','小小心願','goalAmount',10,'language','zh-HK','timeZone','Asia/Hong_Kong'),
 'meta',jsonb_build_object('id','main','databaseSchemaVersion',1,'datasetGeneration',gen_random_uuid()::text,'revision',0),
 'entries','[]'::jsonb,'reasons','[]'::jsonb);
$$;

-- Trust boundary for imported backups. Projects only supported fields, checks
-- references and every intermediate balance rather than trusting the last sum.
create function stamp_private.validate_backup(b jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 w jsonb; s jsonb; m jsonb; r jsonb; e jsonb; original jsonb; projected jsonb;
 reasons jsonb='[]'; entries jsonb='[]'; seen jsonb='{}'; reversed jsonb='{}';
 reason_ids text[]='{}'; reason_keys text[]='{}'; entry_ids text[]='{}'; op_ids text[]='{}';
 rid text; eid text; oid text; key text; txt text; n bigint; seq bigint=0; balance bigint=0; delta bigint;
 kind text; stats jsonb='{"EARN":0,"DEDUCT":0,"SPEND":0}'; stat_value bigint;
begin
 perform stamp_private.assert_true(jsonb_typeof(b)='object' and b->>'appId'='stamp-wallet' and b->'formatVersion'='1'::jsonb and b->'databaseSchemaVersion'='1'::jsonb,'不支援此備份或版本');
 perform stamp_private.iso(b->'exportedAt');
 w=b->'wallet';s=b->'settings';m=b->'meta';
 perform stamp_private.assert_true(jsonb_typeof(w)='object' and jsonb_typeof(s)='object' and jsonb_typeof(m)='object' and w->>'id'='main' and s->>'id'='main' and m->>'id'='main' and m->'databaseSchemaVersion'='1'::jsonb,'戶口或資料版本不正確');
 perform stamp_private.assert_true(s->>'language'='zh-HK' and s->>'timeZone'='Asia/Hong_Kong','語言或時區不支援');
 w=jsonb_build_object('id','main','nickname',stamp_private.clean(w->'nickname'),'balance',stamp_private.num(w->'balance'),'lastSequence',stamp_private.num(w->'lastSequence'));
 s=jsonb_build_object('id','main','goalName',stamp_private.clean(s->'goalName'),'goalAmount',stamp_private.num(s->'goalAmount',1),'language','zh-HK','timeZone','Asia/Hong_Kong');
 m=jsonb_build_object('id','main','databaseSchemaVersion',1,'datasetGeneration',stamp_private.str(m->'datasetGeneration',100),'revision',stamp_private.num(m->'revision'));
 perform stamp_private.assert_true(jsonb_typeof(b->'reasons')='array' and jsonb_typeof(b->'entries')='array','備份清單格式不正確');
 for r in select value from jsonb_array_elements(b->'reasons') loop
  rid=stamp_private.str(r->'id',100);txt=stamp_private.str(r->'text',100);
  perform stamp_private.assert_true(r->>'category' in ('EARN','DEDUCT','SPEND') and jsonb_typeof(r->'archived')='boolean','原因分類或停用值不正確');
  perform stamp_private.assert_true(stamp_private.clean(r->'text')=txt and stamp_private.str(r->'normalizedText',200)=lower(txt collate stamp_private.reason_locale),'原因文字索引不正確');
  key=(r->>'category')||':'||lower(txt collate stamp_private.reason_locale);
  perform stamp_private.assert_true(not rid=any(reason_ids) and not key=any(reason_keys),'原因ID或文字重複');
  reason_ids=array_append(reason_ids,rid);reason_keys=array_append(reason_keys,key);
  reasons=reasons||jsonb_build_array(jsonb_build_object('id',rid,'category',r->>'category','text',txt,'normalizedText',lower(txt collate stamp_private.reason_locale),'archived',r->'archived','createdAt',stamp_private.iso(r->'createdAt'),'updatedAt',stamp_private.iso(r->'updatedAt')));
 end loop;
 for e in select value from jsonb_array_elements(b->'entries') order by stamp_private.num(value->'sequence',1) loop
  eid=stamp_private.str(e->'id',100);oid=stamp_private.str(e->'operationId',100);kind=e->>'kind';n=stamp_private.num(e->'amount',1);
  perform stamp_private.assert_true(not eid=any(entry_ids) and not oid=any(op_ids),'交易ID或operationId重複');
  perform stamp_private.assert_true(e->>'walletId'='main' and kind in ('EARN','DEDUCT','SPEND','REVERSAL'),'交易戶口或種類不正確');
  seq=seq+1;perform stamp_private.assert_true(stamp_private.num(e->'sequence',1)=seq,'入帳次序不完整');
  txt=stamp_private.str(e->'reasonTextSnapshot',100);
  perform stamp_private.assert_true(stamp_private.clean(e->'reasonTextSnapshot')=txt and stamp_private.clean(e->'note',500,false)=stamp_private.str(e->'note',500,false),'交易文字未正規化');
  projected=jsonb_build_object('id',eid,'operationId',oid,'walletId','main','sequence',seq,'kind',kind,'amount',n,'reasonId',e->'reasonId','reasonTextSnapshot',txt,'note',e->>'note','occurredAt',stamp_private.iso(e->'occurredAt'),'createdAt',stamp_private.iso(e->'createdAt'),'balanceAfter',stamp_private.num(e->'balanceAfter'),'intent',stamp_private.str(e->'intent',4000));
  if e ? 'reversesEntryId' then projected=projected||jsonb_build_object('reversesEntryId',stamp_private.str(e->'reversesEntryId',100));end if;
  if kind='REVERSAL' then
   original=seen->(e->>'reversesEntryId');
   perform stamp_private.assert_true(original is not null and original->>'kind'<>'REVERSAL' and not reversed ? (e->>'reversesEntryId') and stamp_private.num(original->'amount',1)=n,'更正引用或金額不正確');
   perform stamp_private.assert_true(e->'reasonId'='null'::jsonb and e->>'note'='' and e->>'occurredAt'=e->>'createdAt','更正欄位不正確');
   reversed=reversed||jsonb_build_object(e->>'reversesEntryId',true);
   delta=case when original->>'kind'='EARN' then -n else n end;
   stat_value=(stats->>(original->>'kind'))::bigint-n;
   stats=jsonb_set(stats,array[original->>'kind'],to_jsonb(stamp_private.num(to_jsonb(stat_value))));
  else
   perform stamp_private.assert_true(not e ? 'reversesEntryId' and (kind='SPEND' or n=1),'交易種類或金額不正確');
   perform stamp_private.assert_true(e->'reasonId'='null'::jsonb or jsonb_typeof(e->'reasonId')='string','原因引用不正確');
   if e->'reasonId'<>'null'::jsonb then
    rid=stamp_private.str(e->'reasonId',100);
    perform stamp_private.assert_true(exists(select 1 from jsonb_array_elements(reasons) x where x->>'id'=rid and x->>'category'=kind),'原因引用不存在或分類不符');
   end if;
   delta=case when kind='EARN' then n else -n end;
   stat_value=(stats->>kind)::bigint+n;
   stats=jsonb_set(stats,array[kind],to_jsonb(stamp_private.num(to_jsonb(stat_value))));
  end if;
  balance=balance+delta;
  perform stamp_private.assert_true(balance>=0 and balance<=9007199254740991,'餘額不足或超出安全範圍');
  perform stamp_private.assert_true(stamp_private.num(e->'balanceAfter')=balance,'記錄後餘額不一致');
  perform stamp_private.assert_true(projected->>'intent'=stamp_private.fingerprint(projected),'操作內容不一致');
  -- Imported attribution is provenance, not an authenticated cloud action.
  projected=projected||jsonb_build_object('actorName','本機匯入');
  entries=entries||jsonb_build_array(projected);seen=seen||jsonb_build_object(eid,projected);
  entry_ids=array_append(entry_ids,eid);op_ids=array_append(op_ids,oid);
 end loop;
 perform stamp_private.assert_true(stamp_private.num(w->'balance')=balance and stamp_private.num(w->'lastSequence')=seq,'戶口與歷史不一致');
 return jsonb_build_object('appId','stamp-wallet','formatVersion',1,'databaseSchemaVersion',1,'exportedAt',stamp_private.iso_now(),'wallet',w,'settings',s,'meta',m,'entries',entries,'reasons',reasons);
end $$;

create function public.family_current() returns jsonb
language plpgsql security definer set search_path='' as $$
declare member stamp_private.members%rowtype; data jsonb; roster jsonb;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 select * into member from stamp_private.members where user_id=auth.uid();
 if not found then return null;end if;
 select f.data into data from stamp_private.families f where f.id=member.family_id;
 select jsonb_agg(jsonb_build_object('userId',user_id,'label',label,'role',role) order by user_id) into roster from stamp_private.members where family_id=member.family_id;
 return jsonb_build_object('familyId',member.family_id,'role',member.role,'members',roster,'backup',jsonb_set(data,'{exportedAt}',to_jsonb(stamp_private.iso_now())));
end $$;

create function public.family_create(p_label text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare fid uuid; label_value text;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 label_value=stamp_private.clean(to_jsonb(p_label));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from stamp_private.members where user_id=auth.uid()) then return public.family_current();end if;
 insert into stamp_private.families(owner_id,data) values(auth.uid(),stamp_private.empty_backup()) returning id into fid;
 insert into stamp_private.members(user_id,family_id,label,role) values(auth.uid(),fid,label_value,'owner');
 return public.family_current();
end $$;

create function public.family_invite() returns text
language plpgsql security definer set search_path='' as $$
declare member stamp_private.members%rowtype; token text; family_data jsonb;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 select * into member from stamp_private.members where user_id=auth.uid();
 perform stamp_private.assert_true(member.role='owner','只有建立家庭的家長可以發出邀請');
 select data into family_data from stamp_private.families where id=member.family_id for update;
 family_data=jsonb_set(family_data,'{meta,revision}',to_jsonb(stamp_private.num(family_data#>'{meta,revision}')+1));
 perform stamp_private.num(family_data#>'{meta,revision}');
 update stamp_private.families set data=family_data where id=member.family_id;
 -- Two UUIDs provide 244 random bits without depending on pgcrypto placement.
 token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into stamp_private.invites(token_hash,family_id,expires_at) values(encode(sha256(convert_to(token,'UTF8')),'hex'),member.family_id,now()+interval '24 hours');
 return token;
end $$;

create function public.family_join(p_token text,p_label text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invite stamp_private.invites%rowtype; label_value text; existing uuid; family_data jsonb;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 label_value=stamp_private.clean(to_jsonb(p_label));
 perform stamp_private.assert_true(p_token ~ '^[a-f0-9]{64}$','邀請碼無效或已過期');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into invite from stamp_private.invites where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 perform stamp_private.assert_true(invite.family_id is not null,'邀請碼無效或已過期');
 select family_id into existing from stamp_private.members where user_id=auth.uid();
 if existing=invite.family_id and invite.consumed_by=auth.uid() then return public.family_current();end if;
 perform stamp_private.assert_true(existing is null,'此帳戶已加入家庭');
 perform stamp_private.assert_true(invite.consumed_by is null and invite.expires_at>now(),'邀請碼無效或已過期');
 select f.data into family_data from stamp_private.families f where f.id=invite.family_id for update;
 family_data=jsonb_set(family_data,'{meta,revision}',to_jsonb(stamp_private.num(family_data#>'{meta,revision}')+1));
 perform stamp_private.num(family_data#>'{meta,revision}');
 insert into stamp_private.members(user_id,family_id,label,role) values(auth.uid(),invite.family_id,label_value,'parent');
 update stamp_private.invites set consumed_by=auth.uid() where token_hash=invite.token_hash;
 update stamp_private.families set data=family_data where id=invite.family_id;
 return public.family_current();
end $$;

create function public.family_apply(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 member stamp_private.members%rowtype; family stamp_private.families%rowtype;
 previous stamp_private.operations%rowtype; d jsonb; reasons jsonb; reason_row jsonb; entry jsonb; original jsonb;
 op_id text; kind text; reason_text text; note_text text; reason_id text; occurred text; stamp text;
 amount_value bigint; balance_value bigint; revision_value bigint; delta bigint; i integer; category text;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 select * into member from stamp_private.members where user_id=auth.uid();
 perform stamp_private.assert_true(member.family_id is not null,'請先建立或加入家庭');
 perform stamp_private.assert_true(jsonb_typeof(p_operation)='object','操作格式不正確');
 op_id=stamp_private.str(p_operation->'operationId',100);
 kind=stamp_private.str(p_operation->'type',30);
 select * into family from stamp_private.families where id=member.family_id for update;
 select * into previous from stamp_private.operations where family_id=family.id and operations.operation_id=op_id;
 if found then
  perform stamp_private.assert_true(previous.actor_id=auth.uid() and previous.payload=p_operation,'同一操作編號不可用於不同內容');
  return public.family_current();
 end if;
 d=family.data; stamp=stamp_private.iso_now();
 perform stamp_private.assert_true(p_operation->>'generation'=d#>>'{meta,datasetGeneration}','資料已更換，請重新載入');
 perform stamp_private.assert_true(not exists(select 1 from jsonb_array_elements(d->'entries') x where x->>'operationId'=op_id),'操作編號已存在');
 revision_value=stamp_private.num(d#>'{meta,revision}')+1;
 perform stamp_private.num(to_jsonb(revision_value));
 if kind in ('SETTINGS','REASON_UPDATE','IMPORT') then
  perform stamp_private.assert_true(stamp_private.num(p_operation->'expectedRevision')=stamp_private.num(d#>'{meta,revision}'),'其他家長已修改資料，請重新載入再確認');
 end if;
 if kind in ('EARN','DEDUCT','SPEND','REVERSAL') then
  balance_value=stamp_private.num(d#>'{wallet,balance}');
  if kind='REVERSAL' then
   select x into original from jsonb_array_elements(d->'entries') x where x->>'id'=stamp_private.str(p_operation->'entryId',100);
   perform stamp_private.assert_true(original is not null and original->>'kind'<>'REVERSAL','找不到可更正的原交易');
   perform stamp_private.assert_true(not exists(select 1 from jsonb_array_elements(d->'entries') x where x->>'reversesEntryId'=original->>'id'),'此交易已撤銷');
   amount_value=stamp_private.num(original->'amount',1);
   delta=case when original->>'kind'='EARN' then -amount_value else amount_value end;
   reason_text=stamp_private.clean(p_operation->'reason');note_text='';occurred=stamp;reason_id=null;
  else
   amount_value=stamp_private.amount(p_operation->'amount');
   perform stamp_private.assert_true(kind='SPEND' or amount_value=1,'加印及扣印每次只可一個');
   reason_text=stamp_private.clean(p_operation->'reason',100,kind<>'EARN');
   if reason_text='' then reason_text='獎勵印仔';end if;
   note_text=stamp_private.clean(p_operation->'note',500,false);
   occurred=stamp_private.iso(p_operation->'occurredAt');
   delta=case when kind='EARN' then amount_value else -amount_value end;
  end if;
  perform stamp_private.assert_true(balance_value+delta>=0,'餘額不足，不能扣印、消費或撤銷加印');
  balance_value=stamp_private.num(to_jsonb(balance_value+delta));
  if kind<>'REVERSAL' then
   reasons=d->'reasons';
   select x into reason_row from jsonb_array_elements(reasons) x where x->>'category'=kind and x->>'normalizedText'=lower(reason_text collate stamp_private.reason_locale);
   if reason_row is null then
    reason_id=gen_random_uuid()::text;
    reason_row=jsonb_build_object('id',reason_id,'category',kind,'text',reason_text,'normalizedText',lower(reason_text collate stamp_private.reason_locale),'archived',false,'createdAt',stamp,'updatedAt',stamp);
    reasons=reasons||jsonb_build_array(reason_row);
   else
    reason_id=reason_row->>'id';
    select ordinality::integer-1 into i from jsonb_array_elements(reasons) with ordinality where value->>'id'=reason_id;
    reasons=jsonb_set(reasons,array[i::text],reason_row||jsonb_build_object('archived',false,'updatedAt',stamp));
   end if;
   d=jsonb_set(d,'{reasons}',reasons);
  end if;
  entry=jsonb_build_object('id',gen_random_uuid()::text,'operationId',op_id,'walletId','main','sequence',stamp_private.num(d#>'{wallet,lastSequence}')+1,'kind',kind,'amount',amount_value,'reasonId',reason_id,'reasonTextSnapshot',reason_text,'note',note_text,'occurredAt',occurred,'createdAt',stamp,'balanceAfter',balance_value,'actorId',auth.uid()::text,'actorName',member.label);
  perform stamp_private.num(entry->'sequence',1);
  if kind='REVERSAL' then entry=entry||jsonb_build_object('reversesEntryId',original->>'id');end if;
  entry=entry||jsonb_build_object('intent',stamp_private.fingerprint(entry));
  d=jsonb_set(d,'{entries}',(d->'entries')||jsonb_build_array(entry));
  d=jsonb_set(jsonb_set(d,'{wallet,balance}',to_jsonb(balance_value)),'{wallet,lastSequence}',entry->'sequence');
 elsif kind='SETTINGS' then
  d=jsonb_set(d,'{wallet,nickname}',to_jsonb(stamp_private.clean(p_operation->'nickname')));
  d=jsonb_set(d,'{settings,goalName}',to_jsonb(stamp_private.clean(p_operation->'goalName')));
  d=jsonb_set(d,'{settings,goalAmount}',to_jsonb(stamp_private.amount(p_operation->'goalAmount')));
 elsif kind in ('REASON_ADD','REASON_UPDATE') then
  reasons=d->'reasons';reason_text=stamp_private.clean(p_operation->'text');
  if kind='REASON_ADD' then
   category=stamp_private.str(p_operation->'category',10);
   perform stamp_private.assert_true(category in ('EARN','DEDUCT','SPEND'),'原因類別不正確');
   select x into reason_row from jsonb_array_elements(reasons) x where x->>'category'=category and x->>'normalizedText'=lower(reason_text collate stamp_private.reason_locale);
   if reason_row is null then
    reason_row=jsonb_build_object('id',gen_random_uuid()::text,'category',category,'text',reason_text,'normalizedText',lower(reason_text collate stamp_private.reason_locale),'archived',false,'createdAt',stamp,'updatedAt',stamp);
    reasons=reasons||jsonb_build_array(reason_row);
   else
    select ordinality::integer-1 into i from jsonb_array_elements(reasons) with ordinality where value->>'id'=reason_row->>'id';
    reasons=jsonb_set(reasons,array[i::text],reason_row||jsonb_build_object('archived',false,'updatedAt',stamp));
   end if;
  else
   reason_id=stamp_private.str(p_operation->'reasonId',100);
   select x into reason_row from jsonb_array_elements(reasons) x where x->>'id'=reason_id;
   perform stamp_private.assert_true(reason_row is not null,'找不到原因');
   perform stamp_private.assert_true(jsonb_typeof(p_operation->'archived')='boolean','停用設定不正確');
   perform stamp_private.assert_true(not exists(select 1 from jsonb_array_elements(reasons) x where x->>'id'<>reason_id and x->>'category'=reason_row->>'category' and x->>'normalizedText'=lower(reason_text collate stamp_private.reason_locale)),'同類別已有此原因');
   select ordinality::integer-1 into i from jsonb_array_elements(reasons) with ordinality where value->>'id'=reason_id;
   reasons=jsonb_set(reasons,array[i::text],reason_row||jsonb_build_object('text',reason_text,'normalizedText',lower(reason_text collate stamp_private.reason_locale),'archived',p_operation->'archived','updatedAt',stamp));
  end if;
  d=jsonb_set(d,'{reasons}',reasons);
 elsif kind='IMPORT' then
  perform stamp_private.assert_true(member.role='owner','只有建立家庭的家長可以匯入');
  perform stamp_private.assert_true(not family.imported and jsonb_array_length(d->'entries')=0 and jsonb_array_length(d->'reasons')=0,'只可向空白家庭匯入一次');
  d=stamp_private.validate_backup(p_operation->'backup');
  perform stamp_private.assert_true(not exists(select 1 from jsonb_array_elements(d->'entries') x where x->>'operationId'=op_id),'匯入操作編號與歷史重複');
  d=jsonb_set(d,'{meta,datasetGeneration}',to_jsonb(gen_random_uuid()::text));
  update stamp_private.families set imported=true where id=family.id;
 else
  raise exception '不支援此操作';
 end if;
 if kind in ('EARN','DEDUCT','SPEND','REVERSAL') then perform stamp_private.validate_backup(d);end if;
 d=jsonb_set(d,'{meta,revision}',to_jsonb(revision_value));
 update stamp_private.families set data=d where id=family.id;
 insert into stamp_private.operations(family_id,operation_id,actor_id,payload) values(family.id,op_id,auth.uid(),p_operation);
 return public.family_current();
end $$;

revoke all on all functions in schema stamp_private from public,anon,authenticated;
revoke all on function public.family_current(),public.family_create(text),public.family_join(text,text),public.family_invite(),public.family_apply(jsonb) from public,anon;
grant execute on function public.family_current(),public.family_create(text),public.family_join(text,text),public.family_invite(),public.family_apply(jsonb) to authenticated;

commit;
