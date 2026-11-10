import { mkdir, writeFile } from 'node:fs/promises';
const queries = [
  'Chinese sign language recognition pretrained',
  'Chinese sign language yolov8',
  '中文 手语 识别 数据集',
];
await mkdir('.runtime-logs/sign-research', { recursive: true });
for (let index = 0; index < queries.length; index++) {
  const query = queries[index];
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=6`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Yuqiao-project-research' }, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    const compact = { query, status: response.status, message: result.message, total: result.total_count, repos: result.items?.map(item => ({ name: item.full_name, url: item.html_url, description: item.description, stars: item.stargazers_count, license: item.license?.spdx_id })) };
    await writeFile(`.runtime-logs/sign-research/search-${index}.json`, JSON.stringify(compact, null, 2));
    console.log(JSON.stringify(compact));
  } catch (error) { console.log(JSON.stringify({ query, error: error.message })); }
}
