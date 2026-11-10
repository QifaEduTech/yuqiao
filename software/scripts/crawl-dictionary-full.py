"""Resumable full traversal of the user-selected public sign dictionary.
Single page fetcher + single image fetcher, at least 2 seconds between requests
to each host. No remote scripts, private APIs, login or challenge bypass.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import math
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote,unquote,urljoin,urlsplit

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'.runtime-logs/dictionary-full'
STATE=RUNTIME/'state.sqlite'
STATUS=RUNTIME/'status.json'
PUBLIC_STATUS=ROOT/'web/public/dictionary-crawl-status.json'
VERSION='bmcx-full-listing-1'
MAX_PAGES=3000
MAX_TERMS=15000

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
c=module('index_crawler',ROOT/'scripts/crawl-sign-dictionary.py')
e=module('illustrated_crawler',ROOT/'scripts/enrich-sign-dictionary.py')

def normalized_url(url):
    parts=urlsplit(url)
    if parts.scheme!='https' or parts.netloc!='shouyu.bmcx.com' or parts.query or parts.fragment:raise ValueError('Unexpected page origin')
    return c.allowed_url(c.ORIGIN+quote(unquote(parts.path),safe='/'))


class ListRows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.rows=[];self.stack=[];self.skip=0;self.anchor=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ('script','style'):self.skip+=1
        if self.skip:return
        if tag=='tr':self.stack.append({'links':[],'cells':[],'images':[],'cell':None})
        if not self.stack:return
        row=self.stack[-1]
        if tag=='td':row['cell']=''
        if tag=='a' and re.fullmatch(r'/\d+__shouyud/',a.get('href','')):self.anchor={'url':c.ORIGIN+a['href'],'term':''}
        if tag=='br' and row['cell'] is not None:row['cell']+='\n'
        if tag=='img':row['images'].append({'url':urljoin(c.ORIGIN+'/',a.get('src','')),'alt':a.get('alt','')})
    def handle_data(self,text):
        if self.skip or not self.stack:return
        if self.stack[-1]['cell'] is not None:self.stack[-1]['cell']+=text
        if self.anchor is not None:self.anchor['term']+=text
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.skip=max(0,self.skip-1)
        if self.skip or not self.stack:return
        row=self.stack[-1]
        if tag=='a' and self.anchor is not None:
            row['links'].append(self.anchor);self.anchor=None
        if tag=='td' and row['cell'] is not None:row['cells'].append(row['cell']);row['cell']=None
        if tag=='tr':self.rows.append(self.stack.pop())


def parse_listing(html,url,category):
    general=c.Page();general.feed(html)
    if category+'类手语' not in general.title:raise ValueError('Category title mismatch or access challenge')
    parser=ListRows();parser.feed(html);items={}
    for row in parser.rows:
        if len(row['links'])!=1:continue
        link=row['links'][0];term=re.sub(r'\s+',' ',link['term']).strip()
        if not term or len(term)>50:raise ValueError('Invalid term label')
        cell=next((x.strip() for x in row['cells'] if x.strip().startswith(term)),None)
        if cell is None:raise ValueError('No description cell for '+term)
        description=re.sub(r'\s+',' ',cell[len(term):]).strip()
        if len(description)>3000:raise ValueError('Unexpectedly long description')
        urls=list(dict.fromkeys(img['url'] for img in row['images'] if img['alt']=='手语'+term and urlsplit(img['url']).path!='/shouyu/_file/no_picture.png'))
        for image in urls:e.image_url(image)
        source_id='bmcx.'+re.search(r'/(\d+)__',link['url']).group(1)
        item={'sourceId':source_id,'term':term,'canonicalUrl':link['url'],'category':category,'description':description,'descriptionStatus':'present' if description else 'missing_at_source','imageStatus':'present' if urls else 'missing_at_source','imageUrls':urls,'sourceListingUrl':url,'detailPageVisited':False}
        if source_id in items and items[source_id]!=item:raise ValueError('Conflicting duplicate source ID on page')
        items[source_id]=item
    # Each advertised detail link must have a parsed corresponding row.
    advertised={x['href'] for x in general.links if re.fullmatch(r'/\d+__shouyud/',x['href'])}
    if advertised!={urlsplit(i['canonicalUrl']).path for i in items.values()}:raise ValueError('Some listed words did not parse')
    if not items:raise ValueError('Empty category page needs manual verification')
    last=1
    for link in general.links:
        path=unquote(urlsplit(urljoin(url,link['href'])).path)
        match=re.fullmatch('/'+re.escape(category)+r'_(\d+)__shouyul/',path)
        if match:last=max(last,int(match.group(1)))
    if last>500:raise ValueError('Unexpected category page count')
    return list(items.values()),last


def open_database(path=STATE):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path);db.row_factory=sqlite3.Row
    db.execute('pragma journal_mode=WAL')
    db.executescript('''
    create table if not exists pages(url text primary key, category text, number integer, status text default 'pending', attempts integer default 0, retry_at real default 0, error text, sha256 text);
    create table if not exists terms(id text primary key, data text not null);
    create table if not exists media(url text primary key, status text default 'pending', attempts integer default 0, retry_at real default 0, error text, asset text);
    create table if not exists meta(key text primary key, value text);
    ''');db.commit();return db


class FullCrawler:
    def __init__(self,args):
        RUNTIME.mkdir(parents=True,exist_ok=True);self.args=args;self.db=open_database();self.started=c.now();self.last_publish=0;self.last_ready=-1;self.last_terms=-1;self.last_images=-1;self.published={};self.blocked=None
        self.fetch=c.Fetcher(max_requests=MAX_PAGES*3+10)
        self.images=None
        if STATUS.exists():
            prior=json.loads(STATUS.read_text(encoding='utf-8'));self.published=prior.get('publication',{})
            if prior.get('stage')=='backoff':
                from datetime import datetime
                deadline=datetime.fromisoformat(prior['updatedAt']).timestamp()+prior.get('retryAfterSeconds',180)
                self.meta('backoffUntil',max(self.meta('backoffUntil') or 0,deadline));self.meta('imageDelay',max(8,self.meta('imageDelay') or 2))
    def count(self,table,where='1',params=()):return self.db.execute('select count(*) from '+table+' where '+where,params).fetchone()[0]
    def meta(self,key,value=None):
        if value is not None:self.db.execute('insert or replace into meta values(?,?)',(key,json.dumps(value,ensure_ascii=False)));self.db.commit();return value
        row=self.db.execute('select value from meta where key=?',(key,)).fetchone();return json.loads(row[0]) if row else None
    def totals(self):
        terms=[json.loads(x['data']) for x in self.db.execute('select data from terms')]
        ready_urls={x['url'] for x in self.db.execute("select url from media where status='done'")}
        ready=sum(bool(t['imageUrls']) and all(u in ready_urls for u in t['imageUrls']) for t in terms)
        publishable=sum(all(u in ready_urls for u in t['imageUrls']) for t in terms)
        return {'categoriesTotal':len(self.meta('categories') or []),'categoriesVisited':self.db.execute("select count(distinct category) from pages where status='done'").fetchone()[0],'pagesDiscovered':self.count('pages'),'pagesDone':self.count('pages',"status='done'"),'pagesFailed':self.count('pages',"status='failed'"),'termsDiscovered':len(terms),'termsIllustrated':ready,'termsReadyToPublish':publishable,'sourceMissingDescription':sum(not t['description'] for t in terms),'sourceMissingImages':sum(not t['imageUrls'] for t in terms),'imagesDiscovered':self.count('media'),'imagesDone':self.count('media',"status='done'"),'imagesFailed':self.count('media',"status='failed'"),'retrying':self.count('pages',"status='retry'")+self.count('media',"status='retry'")}
    def status(self,stage,detail='',**extra):
        data={'schemaVersion':1,'stage':stage,'startedAt':self.started,'updatedAt':c.now(),'detail':detail,**self.totals(),'publication':self.published,**extra}
        c.atomic_json(STATUS,{**data,'pid':os.getpid()});c.atomic_json(PUBLIC_STATUS,data)
        return data
    def wait_backoff(self):
        while True:
            remaining=(self.meta('backoffUntil') or 0)-time.time()
            if remaining<=0:return
            self.status('backoff','源站要求减速，保留进度等待重试。',retryAfterSeconds=math.ceil(remaining),imageIntervalSeconds=self.meta('imageDelay') or 2)
            time.sleep(min(30,remaining))
    def seed(self):
        self.wait_backoff()
        self.fetch.robots();self.images=e.Images(max_requests=MAX_TERMS*3)
        self.images.delay=max(self.images.delay,self.meta('imageDelay') or 2)
        # Revalidate existing files before trusting any resumed "done" image.
        for row in self.db.execute("select url,asset from media where status='done'").fetchall():
            asset=json.loads(row['asset']);path=ROOT/'web/public'/asset['path'].lstrip('/')
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=asset['sha256']:self.db.execute("update media set status='pending',attempts=0,asset=null where url=?",(row['url'],))
        prior=ROOT/'shared/sign-dictionary-content.json'
        if prior.exists():
            for entry in json.loads(prior.read_text(encoding='utf-8'))['entries']:
                for asset in entry.get('gestureImages',[]):
                    path=ROOT/'web/public'/asset['path'].lstrip('/')
                    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==asset['sha256']:
                        self.db.execute("insert into media(url,status,asset) values(?,'done',?) on conflict(url) do update set status='done',asset=excluded.asset",(asset['sourceUrl'],json.dumps(asset,ensure_ascii=False)))
        html,digest=self.fetch.raw(c.ORIGIN+'/');root=c.Page();root.feed(html);categories=[]
        for link in root.links:
            try:url=normalized_url(urljoin(c.ORIGIN+'/',link['href']))
            except ValueError:continue
            match=re.fullmatch(r'/([^/]+)_1__shouyul/',unquote(urlsplit(url).path))
            if match and match.group(1) not in categories:
                categories.append(match.group(1));self.db.execute('insert or ignore into pages(url,category,number) values(?,?,1)',(url,match.group(1)))
        if not categories:raise ValueError('Homepage has no recognized categories')
        self.db.commit();self.meta('categories',categories);self.meta('homepageSha256',digest)
        if self.args.retry_failed:
            for table in ['pages','media']:self.db.execute("update "+table+" set status='pending',attempts=0,retry_at=0 where status='failed'")
            self.db.commit()
    def error(self,table,key,error):
        if isinstance(error,HTTPError) and error.code in (401,403):
            self.blocked=str(error);self.status('blocked','源站限制访问，已停止，不绕过限制。');raise RuntimeError('Access restriction') from error
        column='url';row=self.db.execute('select attempts from '+table+' where '+column+'=?',(key,)).fetchone();attempts=row[0]+1
        retry=attempts<3
        delay=[15,60,180][min(attempts-1,2)]
        if isinstance(error,HTTPError) and error.code==429:
            value=error.headers.get('Retry-After','')
            try:requested=int(value) if value.isdigit() else parsedate_to_datetime(value).timestamp()-time.time()
            except (TypeError,ValueError,OverflowError):requested=180
            delay=max(60,requested);retry=attempts<4
            self.meta('backoffUntil',time.time()+delay)
            interval=min(60,max(8,(self.meta('imageDelay') or 2)*2));self.meta('imageDelay',interval)
            if self.images:self.images.delay=max(self.images.delay,interval)
        self.db.execute('update '+table+' set status=?,attempts=?,retry_at=?,error=? where '+column+'=?',('retry' if retry else 'failed',attempts,time.time()+delay,str(error)[:500],key));self.db.commit()
        if isinstance(error,HTTPError) and error.code==429:self.wait_backoff()
    def discover(self):
        self.status('discovering','正在遍历分类及全部分页。')
        while True:
            row=self.db.execute("select * from pages where status in ('pending','retry') and retry_at<=? order by number,category limit 1",(time.time(),)).fetchone()
            if row is None:
                if self.count('pages',"status in ('pending','retry')"):
                    self.status('discovering','等待失败页面退避重试。');time.sleep(5);continue
                break
            try:
                if not self.fetch.robot.can_fetch(c.AGENT,row['url']):raise RuntimeError('robots denies page')
                html,digest=self.fetch.raw(row['url']);items,last=parse_listing(html,row['url'],row['category'])
                for i in range(1,last+1):
                    url=c.ORIGIN+'/'+quote(row['category'])+'_'+str(i)+'__shouyul/'
                    self.db.execute('insert or ignore into pages(url,category,number) values(?,?,?)',(url,row['category'],i))
                for item in items:
                    item.update({'sourceListingSha256':digest,'retrievedAt':c.now(),'parserVersion':VERSION})
                    existing=self.db.execute('select data from terms where id=?',(item['sourceId'],)).fetchone()
                    if existing:
                        old=json.loads(existing[0])
                        if any(old[k]!=item[k] for k in ('term','description','imageUrls')):raise ValueError('Source ID has conflicting variants: '+item['sourceId'])
                        continue
                    self.db.execute('insert into terms values(?,?)',(item['sourceId'],json.dumps(item,ensure_ascii=False)))
                    for url in item['imageUrls']:self.db.execute('insert or ignore into media(url) values(?)',(url,))
                if self.count('pages')>MAX_PAGES or self.count('terms')>MAX_TERMS:raise ValueError('Unexpected traversal size; manual check required')
                self.db.execute("update pages set status='done',sha256=?,error=null where url=?",(digest,row['url']));self.db.commit()
                self.status('discovering',row['category']+'：已读取第'+str(row['number'])+'页。')
                if self.count('pages',"status='done'")%20==0:self.publish()
            except Exception as error:
                self.db.rollback();self.error('pages',row['url'],error)
        self.publish()
    def publish(self,force=False):
        if (RUNTIME/'publish.hold').exists():return
        stats=self.totals()
        if not force and (time.time()-self.last_publish<60 or (stats['termsDiscovered']==self.last_terms and stats['imagesDone']==self.last_images)):return
        assets={row['url']:json.loads(row['asset']) for row in self.db.execute("select url,asset from media where status='done'")}
        ready=[]
        for row in self.db.execute('select data from terms order by id'):
            item=json.loads(row[0])
            item['gestureImages']=[{**assets[u],'alt':'手语'+item['term']+'参考图'} for u in item['imageUrls'] if u in assets]
            item['imagePending']=any(u not in assets for u in item['imageUrls']);ready.append(item)
        c.atomic_json(RUNTIME/'publish-input.json',{'schemaVersion':1,'terms':ready})
        result=subprocess.run([self.args.node,str(ROOT/'scripts/publish-full-dictionary.mjs')],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode:raise RuntimeError('Publication failed: '+result.stderr[-1500:])
        self.published=json.loads(result.stdout.strip().splitlines()[-1]);self.last_publish=time.time();self.last_ready=stats['termsReadyToPublish'];self.last_terms=stats['termsDiscovered'];self.last_images=stats['imagesDone']
        print(json.dumps({'published':self.published},ensure_ascii=True),flush=True)
    def download(self):
        self.status('downloading','目录遍历结束，正在保存手势图并分批更新词典。')
        while True:
            row=self.db.execute("select * from media where status in ('pending','retry') and retry_at<=? order by attempts,url limit 1",(time.time(),)).fetchone()
            if row is None:
                if self.count('media',"status in ('pending','retry')"):
                    self.status('downloading','等待图片退避重试。');time.sleep(5);continue
                break
            try:
                asset=self.images.fetch(row['url'],'来源词条','source-'+hashlib.sha256(row['url'].encode()).hexdigest()[:20])
                self.db.execute("update media set status='done',asset=?,error=null where url=?",(json.dumps(asset,ensure_ascii=False),row['url']));self.db.commit()
            except Exception as error:self.error('media',row['url'],error)
            self.publish();self.status('downloading','正在下载和校验手势图。')
    def finish(self):
        self.publish(force=True);stats=self.totals()
        issues=stats['pagesFailed']+stats['imagesFailed']+len(self.published.get('conflicts',[]))
        failures={'pages':[dict(r) for r in self.db.execute("select url,category,error from pages where status='failed'")],'images':[dict(r) for r in self.db.execute("select url,error from media where status='failed'")],'missingAtSource':[json.loads(r['data']) for r in self.db.execute('select data from terms') if not json.loads(r['data'])['description'] or not json.loads(r['data'])['imageUrls']]}
        c.atomic_json(RUNTIME/'issues.json',failures)
        if (RUNTIME/'publish.hold').exists():self.status('awaiting_publication','资料已处理，正在等待页面更新。');return
        self.status('completed_with_issues' if issues else 'complete','已完成可遍历目录；仍有失败或冲突项需核对。' if issues else '所有分类、分页和可用配图已处理；原站缺图／缺说明的条目已单独标注。',finishedAt=c.now())
    def run(self):
        try:self.seed();self.discover();self.download();self.finish()
        except Exception as error:
            if not self.blocked:self.status('error',str(error)[:500])
            raise
        finally:self.db.close()


def main():
    policy=ROOT/'shared/dictionary-acquisition.json'
    if policy.exists() and not json.loads(policy.read_text(encoding='utf-8')).get('downloadImages',False):raise SystemExit('Image crawl disabled by user; source links remain for on-demand review.')
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--node',required=True);parser.add_argument('--retry-failed',action='store_true');args=parser.parse_args()
    RUNTIME.mkdir(parents=True,exist_ok=True)
    lock=open(RUNTIME/'runner.lock','a+b');lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
    if os.name=='nt':
        import msvcrt
        try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:raise SystemExit('A dictionary crawler already holds the run lock')
    else:
        import fcntl
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:FullCrawler(args).run()
    finally:lock.close()

if __name__=='__main__':main()
