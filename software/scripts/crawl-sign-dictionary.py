"""Bounded BMCX source-index crawler. Titles/URLs only; no copied descriptions/media.

The site permits crawling in robots.txt but has not granted a reusable content
license. Store discoverable metadata separately, never execute remote scripts.
"""
import argparse
import hashlib
import json
import math
import gzip
import io
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://shouyu.bmcx.com'
AGENT = 'YuqiaoDictionaryIndex/1.0 (noncommercial local reference index)'
VERSION = 'bmcx-metadata-1'
OUT = ROOT / 'shared/sign-dictionary-sources.json'
CACHE = ROOT / '.runtime-logs/dictionary-crawl/cache.json'
REPORT = ROOT / '.runtime-logs/dictionary-crawl/latest-run.json'
MAX_BYTES = 2 * 1024 * 1024
PRIORITY = ['联系','姓名','年龄','地址','抱歉','保留','适应','来得及','访问','会客','时间','今天','明天','昨天','现在','小时','分钟','星期','早晨','晚上']


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def allowed_url(url):
    p = urlsplit(url)
    if p.scheme != 'https' or p.netloc != 'shouyu.bmcx.com' or p.query or p.fragment:
        raise ValueError('URL outside the approved public dictionary origin')
    if p.path != '/' and p.path != '/robots.txt' and not re.fullmatch(r'/\d+__shouyud/', p.path) and not re.fullmatch(r'/[^/]+_\d+__shouyul/', unquote(p.path)):
        raise ValueError('Unsupported public page path')
    return url


class SameOriginRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        allowed_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.images, self.title, self.canonical = [], [], '', None
        self.anchor, self.in_title, self.skip = None, False, 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'title': self.in_title = True
        if tag == 'a': self.anchor = {'href': attrs.get('href', ''), 'text': ''}
        if tag == 'img': self.images.append({'url': attrs.get('src', ''), 'alt': attrs.get('alt', '')})
        if tag == 'link' and attrs.get('rel', '').lower() == 'canonical': self.canonical = attrs.get('href')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        if self.skip: return
        if tag == 'title': self.in_title = False
        if tag == 'a' and self.anchor is not None:
            self.anchor['text'] = re.sub(r'\s+', ' ', self.anchor['text']).strip()
            self.links.append(self.anchor)
            self.anchor = None

    def handle_data(self, data):
        if self.skip: return
        if self.in_title: self.title += data
        if self.anchor is not None: self.anchor['text'] += data


def parse_page(html, url):
    p = Page(); p.feed(html)
    if '验证码' in p.title or '访问限制' in p.title:
        raise ValueError('Access challenge encountered; stop, do not bypass')
    if url.endswith('__shouyud/'):
        match = re.fullmatch(r'(.+?)的手语\s*-.*', p.title.strip())
        if not match or not p.canonical:
            raise ValueError('Missing term title or canonical link')
        term = match.group(1).strip()
        canonical = allowed_url(urljoin(url, p.canonical))
        if canonical != url or not 1 <= len(term) <= 30:
            raise ValueError('Unexpected canonical URL or term')
        images = [urljoin(url, image['url']) for image in p.images if image['alt'] == '手语' + term]
        images = [u for u in images if urlsplit(u).scheme == 'https' and urlsplit(u).netloc == 'd.bmcx.com' and urlsplit(u).path.startswith('/shouyu/_file/')]
        return {'kind': 'term', 'term': term, 'canonicalUrl': canonical, 'referenceImageUrls': list(dict.fromkeys(images))}
    links = []
    for link in p.links:
        try: target = allowed_url(urljoin(url, link['href']))
        except ValueError: continue
        if re.fullmatch(r'/\d+__shouyud/', urlsplit(target).path) or '__shouyul/' in target:
            if link['text'] and len(link['text']) <= 30: links.append({'url': target, 'text': link['text']})
    if not links: raise ValueError('No dictionary index links found')
    return {'kind': 'index', 'links': list({x['url']: x for x in links}.values())}


class Fetcher:
    def __init__(self, delay=2, refresh=False, max_requests=30):
        self.delay, self.refresh, self.last, self.requests = delay, refresh, 0., 0
        self.max_requests = max_requests
        self.opener = build_opener(SameOriginRedirect())
        self.cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
        self.robot = None
        self.events = []

    def raw(self, url):
        allowed_url(url)
        if self.requests >= self.max_requests: raise RuntimeError('Page request safety bound reached')
        time.sleep(max(0, self.delay - (time.monotonic() - self.last)))
        self.last = time.monotonic(); self.requests += 1
        with self.opener.open(Request(url, headers={'User-Agent': AGENT, 'Accept': 'text/html,text/plain'}), timeout=25) as response:
            if response.status != 200: raise ValueError('Unexpected HTTP status')
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES: raise ValueError('Page size limit exceeded')
            if response.headers.get('Content-Encoding','').lower()=='gzip':
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:data=compressed.read(MAX_BYTES+1)
                if len(data)>MAX_BYTES:raise ValueError('Decoded page size limit exceeded')
            text = data.decode(response.headers.get_content_charset() or 'utf-8')
        return text, hashlib.sha256(data).hexdigest()

    def robots(self):
        text, digest = self.raw(ORIGIN + '/robots.txt')
        self.robot = RobotFileParser(); self.robot.parse(text.splitlines())
        self.delay = max(self.delay, self.robot.crawl_delay(AGENT) or 0, self.robot.crawl_delay('*') or 0)
        return {'url': ORIGIN + '/robots.txt', 'retrievedAt': now(), 'sha256': digest, 'text': text.strip()}

    def get(self, url):
        allowed_url(url)
        if self.robot is None or not self.robot.can_fetch(AGENT, url):
            raise ValueError('robots.txt does not permit this URL')
        cached = self.cache.get(url)
        if not self.refresh and cached and cached.get('parserVersion') == VERSION:
            self.events.append({'url': url, 'status': 'cached'})
            return cached
        for attempt in range(2):
            try:
                html, digest = self.raw(url)
                parsed = parse_page(html, url)
                value = {'url': url, 'retrievedAt': now(), 'pageSha256': digest, 'parserVersion': VERSION, 'metadata': parsed}
                self.cache[url] = value; atomic_json(CACHE, self.cache)
                self.events.append({'url': url, 'status': 'fetched'})
                return value
            except HTTPError as error:
                if error.code in (401,403,429): raise RuntimeError('Access/rate restriction: stopped without retry') from error
                if error.code not in (500,502,503,504) or attempt: raise
                time.sleep(5)
            except (URLError, TimeoutError):
                if attempt: raise
                time.sleep(5)


def collect(args):
    if not 1 <= args.limit <= 20: raise ValueError('Pilot limit must be 1..20')
    fetch = Fetcher(max(2., args.delay), args.refresh)
    doc = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'schemaVersion':1,'site':ORIGIN,'mode':'metadata_only','entries':[]}
    report = {'startedAt':now(),'mode':'metadata_only','limit':args.limit,'failures':[]}
    try:
        robot = fetch.robots()
        index = fetch.get(ORIGIN + '/')['metadata']
        candidates = []
        for category in args.categories:
            expected = f'/{category}_1__shouyul/'
            category_link = next((x for x in index['links'] if unquote(urlsplit(x['url']).path) == expected), None)
            if not category_link: raise ValueError('Category not present on homepage: '+category)
            data = fetch.get(category_link['url'])['metadata']
            terms = [x for x in data['links'] if x['url'].endswith('__shouyud/')]
            terms.sort(key=lambda x: PRIORITY.index(x['text']) if x['text'] in PRIORITY else 1000)
            candidates.append([(x,category,category_link['url']) for x in terms])
        selected=[]
        # Round-robin avoids exhausting the budget with the first category.
        for i in range(max(map(len,candidates), default=0)):
            for group in candidates:
                if i<len(group) and group[i][0]['url'] not in {x[0]['url'] for x in selected} and len(selected)<args.limit: selected.append(group[i])
        entries={e['sourceId']:e for e in doc['entries']}
        changed,ids=0,[]
        for link,category,list_url in selected:
            item=fetch.get(link['url']); data=item['metadata']
            if data['term'] != link['text']: raise ValueError('List/detail term mismatch: '+link['url'])
            source_id='bmcx.'+re.search(r'/(\d+)__',link['url']).group(1)
            entry={'sourceId':source_id,'term':data['term'],'category':category,'canonicalUrl':data['canonicalUrl'],'discoveredFrom':list_url,'referenceImageUrls':data['referenceImageUrls'],'retrievedAt':item['retrievedAt'],'pageSha256':item['pageSha256'],'parserVersion':VERSION,'rightsStatus':'reuse_unconfirmed','review':'not_reviewed','contentMode':'metadata_only','descriptionImported':False,'mediaDownloaded':False}
            if entries.get(source_id)!=entry: changed+=1
            entries[source_id]=entry;ids.append(source_id)
            doc.update({'entries':list(entries.values()),'robots':robot,'rights':{'status':'reuse_unconfirmed','copyrightNotice':'All Rights Reserved','apiPage':'https://www.bmcx.com/api/','apiFinding':'网页嵌入接口说明；未发现图文复制／再分发／训练授权','checkedOn':'2026-10-19'},'parserVersion':VERSION})
            atomic_json(OUT,doc)
            print(json.dumps({'sourceId':source_id,'term':entry['term'],'category':category},ensure_ascii=True),flush=True)
        report.update({'selected':len(ids),'sourceIds':ids,'changedMetadata':changed,'totalIndexed':len(entries),'requests':fetch.requests,'events':fetch.events,'finishedAt':now()})
        atomic_json(REPORT,report)
        print(json.dumps({k:v for k,v in report.items() if k not in ('events','sourceIds')},ensure_ascii=True))
    except Exception as error:
        report['failures'].append(str(error));report.update({'requests':fetch.requests,'events':fetch.events,'finishedAt':now()});atomic_json(REPORT,report)
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit',type=int,default=20)
    parser.add_argument('--categories',nargs='+',default=['社交','时间'])
    parser.add_argument('--delay',type=float,default=2.)
    parser.add_argument('--refresh',action='store_true',help='Re-fetch metadata for change detection; never copies descriptions')
    collect(parser.parse_args())
