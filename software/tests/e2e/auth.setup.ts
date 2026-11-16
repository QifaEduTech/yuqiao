import {test,expect} from '@playwright/test';

// 页面现在统一先登录；为端到端用例创建一个测试账号并保存会话。
test('创建端到端测试账号',async({request,baseURL})=>{
  const username=`e2e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
  const response=await request.post('/api/auth/register',{
    headers:{Origin:new URL(baseURL!).origin,'X-Yuqiao-Request':'1'},
    data:{username,password:'e2e-passphrase-2026'},
  });
  expect(response.ok()).toBeTruthy();
  await request.storageState({path:'.runtime-logs/e2e-auth.json'});
});
