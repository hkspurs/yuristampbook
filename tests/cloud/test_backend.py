"""Real PostgreSQL RPC tests. Auth uid is a test shim, not a GoTrue integration."""
import concurrent.futures
import json
import os
import subprocess
import unittest
import uuid

CONTAINER = os.environ['STAMP_TEST_CONTAINER']

def sql(query, user=None, role='authenticated'):
    prefix = "SET client_min_messages TO warning;"
    if user:
        prefix += f"SET ROLE {role};SET request.jwt.claim.sub='{user}';"
    p = subprocess.run(['docker','exec','-i',CONTAINER,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],input=prefix+query,text=True,capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()

def literal(value):
    return "'" + value.replace("'", "''") + "'"

def rpc(name, user, *args):
    encoded = ','.join(literal(json.dumps(a,ensure_ascii=False))+'::jsonb' if isinstance(a,dict) else literal(a) for a in args)
    out=sql(f'SELECT public.{name}({encoded});',user)
    if not out: return None
    try: return json.loads(out)
    except json.JSONDecodeError: return out

class FamilyTests(unittest.TestCase):
    def setUp(self):
        self.dad=str(uuid.uuid4()); self.mom=str(uuid.uuid4());self.stranger=str(uuid.uuid4())
        self.state=rpc('family_create',self.dad,'爸爸')
        token=rpc('family_invite',self.dad)
        rpc('family_join',self.mom,token,'媽媽')
        self.generation=self.current()['backup']['meta']['datasetGeneration']
    def current(self,user=None): return rpc('family_current',user or self.dad)
    def operation(self,kind='EARN',**kwargs):
        return dict(dict(type=kind,operationId=str(uuid.uuid4()),generation=self.generation,amount='1',reason='自己收拾',note='',occurredAt='2026-11-13T01:00:00.000Z'),**kwargs)
    def apply(self,operation,user=None):return rpc('family_apply',user or self.dad,operation)
    def test_unicode_and_javascript_fingerprint(self):
        result=self.apply(self.operation(reason='İ ΟΣ <script> " \\ 星星'))['backup']
        reason=result['reasons'][0]
        self.assertEqual(reason['normalizedText'],reason['text'].lower())
        entry=result['entries'][0]
        expected=dict(kind=entry['kind'],amount=entry['amount'],reason=entry['reasonTextSnapshot'],note=entry['note'],occurredAt=entry['occurredAt'])
        self.assertEqual(entry['intent'],json.dumps(expected,ensure_ascii=False,separators=(',',':')))
    def test_authoritative_balance_and_actor(self):
        self.assertEqual(self.current()['backup']['wallet']['balance'],0)
        self.apply(self.operation()); self.apply(self.operation(),self.mom)
        self.apply(self.operation('DEDUCT')); result=self.apply(self.operation('SPEND'))
        self.assertEqual(result['backup']['wallet']['balance'],0)
        self.assertEqual(result['backup']['entries'][1]['actorName'],'媽媽')
        self.assertEqual(self.current(self.mom)['familyId'],self.state['familyId'])
    def test_private_membership_and_direct_write(self):
        self.assertIsNone(self.current(self.stranger))
        with self.assertRaises(RuntimeError):self.apply(self.operation(),self.stranger)
        for command in ["SELECT * FROM stamp_private.families;", "INSERT INTO stamp_private.members(user_id,family_id,label,role) VALUES (gen_random_uuid(),gen_random_uuid(),'x','owner');", "SELECT public.family_current();"]:
            with self.assertRaises(RuntimeError):sql(command,self.stranger,role='anon' if 'family_current' in command else 'authenticated')
    def test_idempotency_and_payload_mismatch(self):
        op=self.operation();self.apply(op);self.apply(op)
        self.assertEqual(len(self.current()['backup']['entries']),1)
        with self.assertRaises(RuntimeError):self.apply(op,self.mom)
        op['reason']='不同'
        with self.assertRaises(RuntimeError):self.apply(op)
    def test_last_stamp_race(self):
        self.apply(self.operation())
        def spend(user):
            try:self.apply(self.operation('SPEND'),user);return True
            except RuntimeError:return False
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result=list(pool.map(spend,[self.dad,self.mom]))
        self.assertEqual(sum(result),1)
        self.assertEqual(self.current()['backup']['wallet']['balance'],0)
    def test_invalid_numbers_dates_no_orphans(self):
        before=self.current()['backup']
        for amount in ['0','-1','1.5',' ','1e2','9007199254740992','NaN','Infinity']:
            op=self.operation('SPEND');op['amount']=amount
            with self.assertRaises(RuntimeError):self.apply(op)
        op=self.operation();op['occurredAt']='2026-02-30T01:00:00.000Z'
        with self.assertRaises(RuntimeError):self.apply(op)
        with self.assertRaises(RuntimeError):self.apply(self.operation('DEDUCT'))
        after=self.current()['backup'];self.assertEqual(after['entries'],before['entries']);self.assertEqual(after['reasons'],before['reasons'])

    def reversal(self, entry):
        return dict(type='REVERSAL',operationId=str(uuid.uuid4()),generation=self.generation,entryId=entry['id'],reason='家長誤操作更正')
    def test_spend_amount_reversal_and_sequence(self):
        for _ in range(12):self.apply(self.operation())
        result=self.apply(self.operation('SPEND',amount='8',occurredAt='2026-11-12T01:00:00.000Z'))
        self.assertEqual(result['backup']['wallet']['balance'],4)
        spend=result['backup']['entries'][-1]
        with self.assertRaises(RuntimeError):self.apply(self.operation('SPEND',amount='5'))
        refunded=self.apply(self.reversal(spend))['backup']
        self.assertEqual(refunded['wallet']['balance'],12)
        self.assertEqual(refunded['entries'][-1]['amount'],8)
        for entry in [spend,refunded['entries'][-1]]:
            with self.assertRaises(RuntimeError):self.apply(self.reversal(entry))
        self.assertEqual([e['sequence'] for e in refunded['entries']],list(range(1,15)))
    def test_cannot_reverse_consumed_earn(self):
        earn=self.apply(self.operation())['backup']['entries'][0]
        spend=self.apply(self.operation('SPEND'))['backup']['entries'][-1]
        with self.assertRaises(RuntimeError):self.apply(self.reversal(earn))
        self.apply(self.reversal(spend));self.apply(self.reversal(earn))
        self.assertEqual(self.current()['backup']['wallet']['balance'],0)
    def test_reason_management_settings_and_stale_revision(self):
        state=self.apply(self.operation())['backup'];reason=state['reasons'][0]
        op=dict(type='REASON_UPDATE',operationId=str(uuid.uuid4()),generation=self.generation,expectedRevision=state['meta']['revision'],reasonId=reason['id'],text='新名稱',archived=True)
        result=self.apply(op)['backup']
        self.assertEqual(result['entries'][0]['reasonTextSnapshot'],'自己收拾')
        self.assertTrue(result['reasons'][0]['archived'])
        op['operationId']=str(uuid.uuid4())
        with self.assertRaises(RuntimeError):self.apply(op)
        self.apply(dict(type='REASON_ADD',operationId=str(uuid.uuid4()),generation=self.generation,category='EARN',text=' 新名稱 '))
        result=self.current()['backup'];self.assertEqual(len(result['reasons']),1);self.assertFalse(result['reasons'][0]['archived'])
        op=dict(type='SETTINGS',operationId=str(uuid.uuid4()),generation=self.generation,expectedRevision=result['meta']['revision'],nickname='小星星',goalName='<script>alert(1)</script>',goalAmount='20')
        result=self.apply(op)['backup'];self.assertEqual(result['wallet']['balance'],1);self.assertEqual(result['settings']['goalName'],op['goalName'])
    def test_invite_expired_once_and_owner_only(self):
        with self.assertRaises(RuntimeError):rpc('family_invite',self.mom)
        token=rpc('family_invite',self.dad)
        sql("UPDATE stamp_private.invites SET expires_at=now()-interval '1 minute' WHERE token_hash=encode(sha256(convert_to("+literal(token)+",'UTF8')),'hex');")
        with self.assertRaises(RuntimeError):rpc('family_join',self.stranger,token,'另一位')
        token=rpc('family_invite',self.dad);rpc('family_join',self.stranger,token,'另一位')
        with self.assertRaises(RuntimeError):rpc('family_join',str(uuid.uuid4()),token,'其他')
        self.assertEqual(rpc('family_join',self.stranger,token,'另一位')['familyId'],self.state['familyId'])
    def make_import(self, backup):
        return dict(type='IMPORT',operationId=str(uuid.uuid4()),generation=self.generation,expectedRevision=self.current()['backup']['meta']['revision'],backup=backup)
    def test_import_validation_revision_generation_and_attribution(self):
        source=str(uuid.uuid4());rpc('family_create',source,'來源')
        source_gen=rpc('family_current',source)['backup']['meta']['datasetGeneration']
        source_op=self.operation(generation=source_gen)
        backup=rpc('family_apply',source,source_op)['backup']
        import copy
        broken=[]
        b=copy.deepcopy(backup);b['formatVersion']=9;broken.append(b)
        b=copy.deepcopy(backup);b['entries'].append(b['entries'][0]);broken.append(b)
        b=copy.deepcopy(backup);b['entries'][0]['reasonId']='missing';broken.append(b)
        b=copy.deepcopy(backup);b['entries'][0]['amount']=2;broken.append(b)
        b=copy.deepcopy(backup);b['entries'][0]['kind']='DEDUCT';broken.append(b)
        b=copy.deepcopy(backup);b['wallet']['balance']=2;broken.append(b)
        b=copy.deepcopy(backup);b['entries'][0]['kind']='REVERSAL';b['entries'][0]['reversesEntryId']='future';broken.append(b)
        b=copy.deepcopy(backup)
        first=b['entries'][0];second=copy.deepcopy(first)
        first.update(kind='DEDUCT',reasonId=None,balanceAfter=0)
        second.update(id=str(uuid.uuid4()),operationId=str(uuid.uuid4()),sequence=2,reasonId=None,balanceAfter=0)
        for e in [first,second]:
            e['intent']=json.dumps(dict(kind=e['kind'],amount=e['amount'],reason=e['reasonTextSnapshot'],note=e['note'],occurredAt=e['occurredAt']),ensure_ascii=False,separators=(',',':'))
        b['entries']=[first,second];b['wallet'].update(balance=0,lastSequence=2);broken.append(b)
        b=copy.deepcopy(backup);b['entries'][0]['amount']='1';broken.append(b)
        b=copy.deepcopy(backup);b['entries'][0]['reasonTextSnapshot']='x'*101;broken.append(b)
        for b in broken:
            with self.assertRaises(RuntimeError):self.apply(self.make_import(b))
            self.assertEqual(self.current()['backup']['entries'],[])
        with self.assertRaises(RuntimeError):self.apply(self.make_import(backup),self.mom)
        stale=self.make_import(backup);rpc('family_invite',self.dad)
        with self.assertRaises(RuntimeError):self.apply(stale)
        op=self.make_import(backup);result=self.apply(op)['backup']
        self.assertEqual(result['wallet']['balance'],1)
        self.assertEqual(result['entries'][0]['actorName'],'本機匯入')
        self.assertNotEqual(result['meta']['datasetGeneration'],self.generation)
        self.apply(op) # lost response retry after generation changed
        with self.assertRaises(RuntimeError):self.apply(self.operation())
        self.generation=result['meta']['datasetGeneration']
        with self.assertRaises(RuntimeError):self.apply(self.make_import(backup))
    def test_transaction_rollback_after_reason_and_entry_preparation(self):
        self.apply(self.operation())
        before=self.current()['backup']
        # Force the last SQL write to fail, after family.data was updated.
        sql("CREATE FUNCTION stamp_private.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected disk failure'; END $$; CREATE TRIGGER fail_insert BEFORE INSERT ON stamp_private.operations FOR EACH ROW EXECUTE FUNCTION stamp_private.test_fail();")
        try:
            with self.assertRaises(RuntimeError):self.apply(self.operation(reason='只在失敗交易出現'))
        finally:sql('DROP TRIGGER fail_insert ON stamp_private.operations; DROP FUNCTION stamp_private.test_fail();')
        after=self.current()['backup']
        for key in ['wallet','entries','reasons','meta']:self.assertEqual(before[key],after[key])

if __name__=='__main__': unittest.main(verbosity=2)
