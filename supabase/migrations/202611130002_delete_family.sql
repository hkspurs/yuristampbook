begin;
-- Explicit owner-only deletion. The expected snapshot prevents deleting new work
-- submitted by another parent after the confirmation screen was opened.
create function public.family_delete(p_family_id uuid, p_generation text, p_revision bigint, p_confirmation text)
returns boolean language plpgsql security definer set search_path='' as $$
declare family stamp_private.families%rowtype;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 perform stamp_private.assert_true(p_confirmation='刪除家庭','請輸入「刪除家庭」確認');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into family from stamp_private.families where id=p_family_id for update;
 -- An exact old-family retry must never delete the user's newly joined family.
 if not found then return true;end if;
 perform stamp_private.assert_true(family.owner_id=auth.uid() and exists(
  select 1 from stamp_private.members where user_id=auth.uid() and family_id=p_family_id and role='owner'
 ),'只有建立此家庭的家長可以刪除');
 perform stamp_private.assert_true(family.data#>>'{meta,datasetGeneration}'=p_generation,'家庭資料已變更，請重新預覽');
 perform stamp_private.assert_true((family.data#>>'{meta,revision}')::bigint=p_revision,'其他家長已修改資料，請重新預覽及備份');
 delete from stamp_private.invites where family_id=p_family_id;
 delete from stamp_private.operations where family_id=p_family_id;
 delete from stamp_private.members where family_id=p_family_id;
 delete from stamp_private.families where id=p_family_id;
 return true;
end $$;
revoke all on function public.family_delete(uuid,text,bigint,text) from public,anon;
grant execute on function public.family_delete(uuid,text,bigint,text) to authenticated;

create or replace function public.family_join(p_token text,p_label text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invite stamp_private.invites%rowtype; label_value text; existing uuid; family_data jsonb;
begin
 perform stamp_private.assert_true(auth.uid() is not null,'請先登入');
 label_value=stamp_private.clean(to_jsonb(p_label));
 perform stamp_private.assert_true(p_token ~ '^[a-f0-9]{64}$','邀請碼無效或已過期');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into invite from stamp_private.invites where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 perform stamp_private.assert_true(invite.family_id is not null,'邀請碼無效或已過期');
 -- Lock the family before the invite, matching deletion and invite creation.
 select data into family_data from stamp_private.families where id=invite.family_id for update;
 perform stamp_private.assert_true(family_data is not null,'家庭已刪除');
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


commit;
