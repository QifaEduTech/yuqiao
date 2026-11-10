import type {Page} from '@playwright/test';
import {resolveExpression} from '../../shared/sign-expression.mjs';

// Deterministic UI fixture only. Production uses LocalLanguageService.
// Real model behavior is checked separately by scripts/check-local-language.mjs.
export async function mockExpressionForUi(page:Page){
 await page.route('**/api/sign/resolve',route=>{
  const body=route.request().postDataJSON();
  if(!['expression','playback'].includes(body.mode))return route.continue();
  const result=resolveExpression(body.text);
  return route.fulfill({json:body.mode==='playback'?{status:result.status,preview:result.preview,reason:result.reason}:result});
 });
}
