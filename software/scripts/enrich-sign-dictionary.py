"""Explicit user-requested enrichment of the existing small dictionary batch.
Keeps original wording, credits and rights status; never produces animation/model labels.
"""
import importlib.util
import hashlib
import io
import gzip
import json
import re
import struct
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_crawler',ROOT/'scripts/crawl-sign-dictionary.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
OUT=ROOT/'shared/sign-dictionary-content.json'
ASSETS=ROOT/'web/public/dictionary-images'
VERSION='bmcx-illustrated-1'


class DescriptionParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cells=[];self.stack=[];self.skip=0;self.strong=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.skip+=1
        if self.skip:return
        if tag=='td':self.stack.append({'text':'','strong':''})
        if tag=='strong':self.strong+=1
        if tag=='br' and self.stack:self.stack[-1]['text']+='\n'
    def handle_data(self,data):
        if self.skip or not self.stack:return
        self.stack[-1]['text']+=data
        if self.strong:self.stack[-1]['strong']+=data
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.skip=max(0,self.skip-1)
        if self.skip:return
        if tag=='strong':self.strong=max(0,self.strong-1)
        if tag=='td' and self.stack:self.cells.append(self.stack.pop())


def extract_description(html,term):
    parser=DescriptionParser();parser.feed(html)
    found=[]
    for cell in parser.cells:
        text=cell['text'].strip()
        if cell['strong'].strip()==term and text.startswith(term):
            description=re.sub(r'\s+',' ',text[len(term):]).strip()
            if 5<=len(description)<=1500:found.append(description)
    found=list(dict.fromkeys(found))
    if len(found)!=1:raise ValueError('Missing or ambiguous description: '+term)
    return found[0]


def image_url(url):
    p=urlsplit(url)
    if p.scheme!='https' or p.netloc!='d.bmcx.com' or p.query or p.fragment or not re.fullmatch(r'/shouyu/_file/[a-f0-9]/[a-f0-9]{8,64}\.png',p.path):
        raise ValueError('Unexpected gesture-image URL')
    return url


class ImageRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        image_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)


class Images:
    def __init__(self, max_requests=32):
        self.opener=build_opener(ImageRedirect());self.last=0;self.requests=0;self.robot=RobotFileParser()
        self.max_requests=max_requests
        try:
            with self.opener.open(Request('https://d.bmcx.com/robots.txt',headers={'User-Agent':c.AGENT}),timeout=25) as response:text=response.read(128000).decode('utf-8')
            self.robot.parse(text.splitlines())
        except HTTPError as error:
            if error.code not in (404,410):raise
            self.robot.parse(['User-agent: *','Allow: /'])
        self.delay=max(2,self.robot.crawl_delay(c.AGENT) or 0,self.robot.crawl_delay('*') or 0)
    def fetch(self,url,term,key,existing=None):
        image_url(url)
        if not self.robot.can_fetch(c.AGENT,url):raise ValueError('Image path disallowed by robots')
        if existing and existing.get('sourceUrl')==url and re.fullmatch(r'/dictionary-images/[a-z0-9.-]+\.(png|webp|jpg)',existing.get('path','')):
            local=ROOT/'web/public'/existing['path'].lstrip('/')
            if local.exists() and hashlib.sha256(local.read_bytes()).hexdigest()==existing.get('sha256'):return existing
        if self.requests>=self.max_requests:raise ValueError('Image request safety bound reached')
        time.sleep(max(0,self.delay-(time.monotonic()-self.last)));self.last=time.monotonic();self.requests+=1
        with self.opener.open(Request(url,headers={'User-Agent':c.AGENT,'Accept':'image/png'}),timeout=25) as response:
            if response.status!=200:raise ValueError('Image response not successful')
            data=response.read(5*1024*1024+1)
            encoding=response.headers.get('Content-Encoding','').lower()
        if len(data)>5*1024*1024:raise ValueError('Image size limit exceeded')
        if encoding=='gzip':
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:data=compressed.read(5*1024*1024+1)
            if len(data)>5*1024*1024:raise ValueError('Decompressed image size limit exceeded')
        picture=Image.open(io.BytesIO(data));width,height=picture.size
        formats={'PNG':('png','image/png'),'WEBP':('webp','image/webp'),'JPEG':('jpg','image/jpeg')}
        if picture.format not in formats:raise ValueError('Unsupported actual image format')
        extension,mime=formats[picture.format]
        if not 0<width*height<=20000000:raise ValueError('Unexpected image dimensions')
        picture.verify()
        digest=hashlib.sha256(data).hexdigest();filename=key+'-'+digest[:16]+'.'+extension;ASSETS.mkdir(parents=True,exist_ok=True)
        (ASSETS/filename).write_bytes(data)
        return {'path':'/dictionary-images/'+filename,'sourceUrl':url,'sha256':digest,'width':width,'height':height,'contentType':mime,'alt':'手语'+term+'参考图','retrievedAt':c.now()}


def run():
    policy=ROOT/'shared/dictionary-acquisition.json'
    if policy.exists() and not json.loads(policy.read_text(encoding='utf-8')).get('downloadImages',False):raise SystemExit('Image download disabled by user; browse source pages only when authoring a motion.')
    sources=json.loads((ROOT/'shared/sign-dictionary-sources.json').read_text(encoding='utf-8'))
    dictionary=json.loads((ROOT/'shared/sign-dictionary.json').read_text(encoding='utf-8'))
    if len(sources['entries'])>20:raise ValueError('Only the existing 20-entry pilot is authorized in this enrichment command')
    previous=json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'schemaVersion':1,'entries':[]}
    entries={e['dictionaryId']:e for e in previous['entries']}
    fetch=c.Fetcher();robot=fetch.robots();media=Images()
    records=[]
    for source in sources['entries']:
        did='csl.ref.'+source['sourceId'];old=entries.get(did)
        if old and old.get('parserVersion')==VERSION and old.get('sourceUrl')==source['canonicalUrl'] and old.get('term')==source['term']:
            entry=old
        else:
            if not fetch.robot.can_fetch(c.AGENT,source['canonicalUrl']):raise ValueError('Page path disallowed')
            html,digest=fetch.raw(source['canonicalUrl']);meta=c.parse_page(html,source['canonicalUrl'])
            if meta['term']!=source['term'] or not meta['referenceImageUrls']:raise ValueError('Term/image mismatch')
            description=extract_description(html,source['term'])
            entry={'dictionaryId':did,'term':source['term'],'description':description,'descriptionOrigin':'source_verbatim','descriptionSha256':hashlib.sha256(description.encode()).hexdigest(),'sourceUrl':source['canonicalUrl'],'sourcePageSha256':digest,'retrievedAt':c.now(),'parserVersion':VERSION,'rightsStatus':'reuse_unconfirmed','review':'not_reviewed','acquisition':'user_requested_reference','imageUrls':meta['referenceImageUrls'],'gestureImages':[]}
        entry['gestureImages']=[media.fetch(url,entry['term'],source['sourceId'].replace('.','-')+'-'+str(i),next((x for x in entry.get('gestureImages',[]) if x['sourceUrl']==url),None)) for i,url in enumerate(entry['imageUrls'])]
        entries[did]=entry;records.append(did)
        c.atomic_json(OUT,{'schemaVersion':1,'mode':'user_requested_illustrated_reference','robots':robot,'entries':list(entries.values())})
        print(json.dumps({'word':entry['term'],'characters':len(entry['description']),'images':len(entry['gestureImages'])},ensure_ascii=True),flush=True)
    # This word/description/image was supplied directly in the current user message.
    did='csl.yes';old=entries.get(did,{});url='https://d.bmcx.com/shouyu/_file/c/ed9305275555e84d.png'
    description='一手食、中指相搭，并点动一下。'
    entries[did]={'dictionaryId':did,'term':'是','description':description,'descriptionOrigin':'user_provided','descriptionSha256':hashlib.sha256(description.encode()).hexdigest(),'sourceUrl':url,'retrievedAt':c.now(),'parserVersion':VERSION,'rightsStatus':'reuse_unconfirmed','review':'not_reviewed','acquisition':'user_provided_reference','imageUrls':[url],'gestureImages':[media.fetch(url,'是','user-shi',next(iter(old.get('gestureImages',[])),None))]}
    records.append(did)
    # Existing user-supplied illustrations get local copies without changing their definitions.
    for original in dictionary['entries']:
        url=original.get('referenceUrl','')
        if not url.startswith('https://d.bmcx.com/shouyu/_file/'):continue
        if original['id'] in records:continue
        old=entries.get(original['id'],{})
        entries[original['id']]={'dictionaryId':original['id'],'term':original['text'],'description':original['description'],'descriptionOrigin':'existing_project_definition','sourceUrl':url,'retrievedAt':c.now(),'parserVersion':VERSION,'rightsStatus':'reuse_unconfirmed','review':'not_reviewed','acquisition':'user_provided_reference','imageUrls':[url],'gestureImages':[media.fetch(url,original['text'],original['id'].replace('.','-'),next(iter(old.get('gestureImages',[])),None))]}
        records.append(original['id'])
    c.atomic_json(OUT,{'schemaVersion':1,'mode':'user_requested_illustrated_reference','robots':robot,'entries':list(entries.values())})
    c.atomic_json(ROOT/'.runtime-logs/dictionary-crawl/illustrated-run.json',{'finishedAt':c.now(),'records':records,'recordCount':len(records),'pageRequests':fetch.requests,'imageRequests':media.requests,'mediaBytes':sum((ROOT/'web/public'/img['path'].lstrip('/')).stat().st_size for e in entries.values() for img in e['gestureImages'])})
    print(json.dumps({'completed':len(records),'pageRequests':fetch.requests,'imageRequests':media.requests}))

if __name__=='__main__':run()
