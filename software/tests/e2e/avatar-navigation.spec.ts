import {test,expect,type Page,type Locator} from '@playwright/test';

async function drag(page:Page,canvas:Locator,button:'left'|'right',dx:number,dy:number){
  const box=(await canvas.boundingBox())!;
  const x=box.x+box.width*.38,y=box.y+box.height*.45;
  await page.mouse.move(x,y);await page.mouse.down({button});
  await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up({button});
  await page.waitForTimeout(850);
}
async function snapshot(page:Page){
  return page.evaluate(()=>{
    const {camera,controls}=(window as any).__annyPreview;
    return {position:camera.position.toArray() as number[],target:controls.target.toArray() as number[],quaternion:camera.quaternion.toArray() as number[],distance:camera.position.distanceTo(controls.target) as number};
  });
}
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('预览页支持背面旋转、右键二维平移与缩放，窗口变化保留视角，复位不打断动作',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/anny-review.html');
  await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});
  const canvas=page.locator('.anny-viewport canvas');const original=await snapshot(page);
  await drag(page,canvas,'left',300,0);
  const rotated=await snapshot(page);
  expect(rotated.position[2]-rotated.target[2]).toBeLessThan(0);
  expect(distance(rotated.target,original.target)).toBeLessThan(.00001);

  await drag(page,canvas,'right',65,90);
  const panned=await snapshot(page);
  expect(distance(panned.target,rotated.target)).toBeGreaterThan(.1);
  expect(Math.abs(panned.target[1]-rotated.target[1])).toBeGreaterThan(.05);
  expect(distance(panned.quaternion,rotated.quaternion)).toBeLessThan(.002);
  expect(Math.abs(panned.distance-rotated.distance)).toBeLessThan(.001);
  expect(await canvas.evaluate(element=>!element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})))).toBe(true);

  const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  const scroll=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,-700);await page.waitForTimeout(400);
  const zoomed=await snapshot(page);expect(zoomed.distance).toBeLessThan(panned.distance*.85);
  expect(await page.evaluate(()=>scrollY)).toBe(scroll);
  await page.setViewportSize({width:1100,height:900});await page.waitForTimeout(500);
  const resized=await snapshot(page);
  expect(distance(resized.position,zoomed.position)).toBeLessThan(.00001);
  expect(distance(resized.target,zoomed.target)).toBeLessThan(.00001);
  await page.screenshot({path:'.runtime-logs/anny-navigation-free.png',fullPage:true});

  await page.getByTestId('motion-play').click();
  await page.getByRole('button',{name:'重置视角',exact:true}).click();await page.waitForTimeout(300);
  const reset=await snapshot(page);
  expect(reset.target[0]).toBeCloseTo(0);expect(reset.target[1]).toBeCloseTo(.86);expect(reset.position[2]).toBeGreaterThan(reset.target[2]);
  await expect(page.getByRole('button',{name:'暂停动作',exact:true})).toBeEnabled();
  expect(Number(await page.getByRole('slider',{name:'动作进度'}).inputValue())).toBeGreaterThan(.1);
  await page.getByRole('button',{name:'暂停动作',exact:true}).click();
  await page.screenshot({path:'.runtime-logs/anny-navigation-reset.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('首页相同鼠标操作能平移、放大和旋转，并可一键恢复',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});
  const canvas=page.getByTestId('avatar').locator('canvas');
  const before=await canvas.screenshot();
  await drag(page,canvas,'right',50,70);
  const panned=await canvas.screenshot();expect(Buffer.compare(before,panned)).not.toBe(0);
  await page.getByRole('button',{name:'恢复正面视角'}).click();
  await canvas.hover();await page.mouse.wheel(0,-600);await page.waitForTimeout(350);
  const zoomed=await canvas.screenshot();expect(Buffer.compare(before,zoomed)).not.toBe(0);
  await drag(page,canvas,'left',220,0);
  const rotated=await canvas.screenshot();expect(Buffer.compare(zoomed,rotated)).not.toBe(0);
  await page.getByRole('button',{name:'恢复正面视角'}).click();await page.waitForTimeout(250);
  const reset=await canvas.screenshot();expect(Buffer.compare(rotated,reset)).not.toBe(0);
  await page.screenshot({path:'.runtime-logs/anny-home-navigation.png',fullPage:true});
});
