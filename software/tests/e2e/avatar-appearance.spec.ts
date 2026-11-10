import {test,expect} from '@playwright/test';
const key='yuqiao.anny.appearance.v1';

test('旧基础套装配置迁移为男性穿搭，暖黄肤色固定，基础网格与入口已删除',async({page})=>{
  await page.addInitScript(key=>localStorage.setItem(key,JSON.stringify({garment:'basic',style:'raglan',skin:'transparent',eyes:'invalid'})),key);
  await page.goto('/anny-review.html');await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});await page.getByRole('button',{name:'人物外观',exact:true}).click();
  await expect(page.getByRole('button',{name:'男性穿搭',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'基础套装',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'圆领短袖',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'人物外观'})).toContainText('自然暖黄');
  const result=await page.evaluate(()=>{const {appearance:a,rig}=(window as any).__annyPreview;return {base:!!rig.scene.getObjectByName('anny-shirt')||!!rig.scene.getObjectByName('anny-trousers'),visible:rig.scene.visible,skin:rig.mesh.material.color.getHexString(),eyeVertices:a.face.eyeVertices,clothes:a.wardrobe.meshes.filter((m:any)=>m.visible).map((m:any)=>m.name)};});
  expect(result.base).toBe(false);expect(result.visible).toBe(true);expect(result.skin).toBe('cfae8c');expect(result.eyeVertices).toBeGreaterThan(140);expect(result.clothes).toEqual(['wardrobe-tee','wardrobe-trousers']);
});

test('性别穿搭与面部选项保持文字和动作进度，刷新及另一标签页同步',async({page,context})=>{
  await page.goto('/');await page.getByLabel('输入要表达的中文').fill('你好我爱你');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByTestId('home-motion-play')).toBeEnabled({timeout:30000});await page.getByTestId('home-motion-play').click();
  await expect.poll(async()=>Number(await page.getByLabel('首页动作进度').inputValue())).toBeGreaterThan(.2);await page.getByRole('button',{name:'暂停动作',exact:true}).click();const time=await page.getByLabel('首页动作进度').inputValue();await page.getByRole('button',{name:'人物外观',exact:true}).click();
  for(const name of ['女性穿搭','灰蓝眼','柔和细节','束发髻'])await page.getByRole('button',{name,exact:true}).click();await expect(page.getByLabel('首页动作进度')).toHaveValue(time);await expect(page.getByLabel('输入要表达的中文')).toHaveValue('你好我爱你');
  await page.keyboard.press('Escape');await page.getByTestId('home-motion-play').click();await expect.poll(async()=>Number(await page.getByLabel('首页动作进度').inputValue())).toBeGreaterThan(Number(time));
  const second=await context.newPage();await second.goto('/anny-review.html');await expect(second.getByTestId('motion-play')).toBeEnabled({timeout:30000});await second.getByRole('button',{name:'人物外观',exact:true}).click();await expect(second.getByRole('button',{name:'女性穿搭',exact:true})).toHaveAttribute('aria-pressed','true');await expect(second.getByRole('button',{name:'灰蓝眼',exact:true})).toHaveAttribute('aria-pressed','true');
  await second.getByRole('button',{name:'男性穿搭',exact:true}).click();await page.getByRole('button',{name:'人物外观',exact:true}).click();await expect(page.getByRole('button',{name:'男性穿搭',exact:true})).toHaveAttribute('aria-pressed','true');await page.reload();await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});await page.getByRole('button',{name:'人物外观',exact:true}).click();await expect(page.getByRole('button',{name:'灰蓝眼',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'恢复默认外观',exact:true}).click();await expect(page.getByRole('button',{name:'深棕眼',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('衣服保留12权重；面部细节不修改骨骼、顶点、表情或导致着色器错误',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.goto('/anny-review.html');await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});
  const result=await page.evaluate(()=>{const {appearance:a,rig}=(window as any).__annyPreview;return a.wardrobe.meshes.map((m:any)=>{let error=0,hand=0;const g=m.geometry;for(let i=0;i<g.attributes.position.count;i++){let sum=0,h=0;for(let s=0;s<3;s++)for(let k=0;k<4;k++){const w=g.attributes[s?`weights_${s}`:'skinWeight'].getComponent(i,k),j=g.attributes[s?`joints_${s}`:'skinIndex'].getComponent(i,k);sum+=w;if(/^(wrist|finger|metacarpal)/.test(rig.mesh.skeleton.bones[j].name))h+=w;}error=Math.max(error,Math.abs(sum-1));hand=Math.max(hand,h);}return {error,hand,opaque:!m.material.transparent&&m.material.opacity===1};});});
  for(const s of result){expect(s.error).toBeLessThan(.000001);expect(s.hand).toBeLessThan(.001);expect(s.opaque).toBe(true);}
  await page.getByRole('slider',{name:'动作进度',exact:true}).fill('1.7');const pose=()=>page.evaluate(()=>{const r=(window as any).__annyPreview.rig;return {bones:r.mesh.skeleton.bones.map((b:any)=>b.quaternion.toArray()),morph:r.mesh.morphTargetInfluences,position:Array.from(r.mesh.geometry.attributes.position.array)};});const before=await pose();
  await page.getByRole('button',{name:'人物外观',exact:true}).click();for(const name of ['浅棕眼','柔和细节','女性穿搭'])await page.getByRole('button',{name,exact:true}).click();expect(await pose()).toEqual(before);await page.getByRole('button',{name:'关闭人物外观'}).click();await page.getByRole('button',{name:'面部特写',exact:true}).click();await page.getByRole('button',{name:'眉眼与嘴部表情',exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:'.runtime-logs/appearance-face-test.png'});expect(errors).toEqual([]);
});

test('服装缓慢或失败时人物隐藏，重试成功才显示完整穿着',async({page})=>{
  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});await page.route('**/avatar-wardrobe/tee-color.jpg',async route=>{await wait;await route.abort();});await page.goto('/anny-review.html');await page.waitForFunction(()=>!!(window as any).__annyPreview);
  expect(await page.evaluate(()=>(window as any).__annyPreview.rig.scene.visible)).toBe(false);await expect(page.getByTestId('motion-play')).toHaveCount(0);release();await expect(page.getByRole('status')).toContainText('人物暂不显示');expect(await page.evaluate(()=>(window as any).__annyPreview.rig.scene.visible)).toBe(false);
  await page.unroute('**/avatar-wardrobe/tee-color.jpg');await page.getByRole('button',{name:'重新加载服装',exact:true}).click();await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});expect(await page.evaluate(()=>(window as any).__annyPreview.rig.scene.visible)).toBe(true);
});

test('手机面板不挡播放控制，存储失败时仍能切换面部细节',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByLabel('输入要表达的中文').fill('谢谢');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByTestId('home-motion-play')).toBeEnabled({timeout:30000});const trigger=page.getByRole('button',{name:'人物外观',exact:true});await trigger.click();
  const box=(await page.getByRole('dialog',{name:'人物外观'}).boundingBox())!,button=(await trigger.boundingBox())!,controls=(await page.getByRole('region',{name:'首页动作试播'}).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y).toBeGreaterThan(0);expect(button.y+button.height).toBeLessThan(controls.y);
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('quota');};});await page.getByRole('button',{name:'灰蓝眼',exact:true}).click();await expect(page.getByRole('dialog',{name:'人物外观'}).getByRole('status')).toContainText('本次外观已应用');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('首页服装失败不露出人物，保留输入并支持原地重试',async({page})=>{
  await page.route('**/avatar-wardrobe/*-color.jpg',route=>route.abort());await page.goto('/');await page.getByLabel('输入要表达的中文').fill('你好');await expect(page.getByRole('alert')).toContainText('暂时无法显示数字人');await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','false');await page.unroute('**/avatar-wardrobe/*-color.jpg');await page.getByRole('button',{name:'重新加载服装',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});await expect(page.getByLabel('输入要表达的中文')).toHaveValue('你好');
});
