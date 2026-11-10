const urls = [
  'https://github.com/user-attachments/assets/999a6f5b-61dd-48e1-b902-bb3f9cbc7247',
  'https://www.bilibili.com/video/BV1bUwezvEnG/',
  'https://player.bilibili.com/player.html?bvid=BV1bUwezvEnG&autoplay=0',
];
await Promise.all(urls.map(async url => {
  try { const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) }); console.log(JSON.stringify({ url, finalUrl: response.url, status: response.status, type: response.headers.get('content-type'), length: response.headers.get('content-length') })); }
  catch (error) { console.log(JSON.stringify({ url, error: error.message })); }
}));
