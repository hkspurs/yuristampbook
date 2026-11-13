import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const {getSession}=vi.hoisted(()=>({getSession:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{getSession}})}));
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_test');getSession.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('binds checked identity token and rejects response after account change',async()=>{
 getSession.mockResolvedValueOnce({data:{session:{user:{id:'dad'},access_token:'dad-token'}}}).mockResolvedValueOnce({data:{session:{user:{id:'mom'},access_token:'mom-token'}}});
 const fetchMock=vi.fn().mockResolvedValue(new Response('{}',{status:200}));vi.stubGlobal('fetch',fetchMock);
 const {rpc}=await import('../../src/cloud/client');await expect(rpc('dad','family_apply',{})).rejects.toThrow('登入已變更');
 expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer dad-token');
});
it('does not send a request when the intended account is not signed in',async()=>{
 getSession.mockResolvedValue({data:{session:{user:{id:'mom'}}}});const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);const {rpc}=await import('../../src/cloud/client');await expect(rpc('dad','family_apply',{})).rejects.toThrow('登入');expect(fetchMock).not.toHaveBeenCalled();
});
