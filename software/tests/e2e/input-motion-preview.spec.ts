import {test,expect,type Page} from '@playwright/test';
import {mockExpressionForUi} from './expression-fixture';
test.beforeEach(async({page})=>mockExpressionForUi(page));
async function submit(page:Page,text:string){await page.getByLabel('输入要表达的中文').fill(text);await page.getByRole('button',{name:'提交文字',exact:true}).click();}
const avatar=(page:Page)=>page.getByTestId('avatar');
const playing=(page:Page)=>expect(avatar(page)).toHaveAttribute('data-playing','true',{timeout:30000});

test('首页不显示动作匹配链接，独立动作库仍可打开且不自动播放',async({page})=>{
 await page.goto('/');await submit(page,'谢谢');await playing(page);await expect(page.getByRole('link',{name:'预览“谢谢”动作'})).toHaveCount(0);
 await page.goto('/anny-review.html?motion=csl.thanks&version=user-description-3');await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});await expect(page.getByRole('button',{name:'暂停动作',exact:true})).toBeDisabled();
});
test('无效或过期动作链接仍拒绝，不默认改播其他动作',async({page})=>{
 for(const query of ['motion=csl.missing','motion=csl.thanks&version=old']){await page.goto('/anny-review.html?'+query);await expect(page.getByRole('alert')).toContainText(/没有找到|版本已更新/,{timeout:30000});await expect(page.getByTestId('motion-play')).toHaveCount(0);}
});
