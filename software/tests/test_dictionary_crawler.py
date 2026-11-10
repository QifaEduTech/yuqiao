import importlib.util
import unittest
from pathlib import Path
from urllib.robotparser import RobotFileParser

spec=importlib.util.spec_from_file_location('crawler',Path(__file__).resolve().parents[1]/'scripts/crawl-sign-dictionary.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class DictionaryCrawlerTests(unittest.TestCase):
 def test_metadata_excludes_descriptions_and_scripts(self):
  html='<title>测试词的手语 - 测试</title><link rel="canonical" href="https://shouyu.bmcx.com/10__shouyud/"><p>不应入库的动作长说明</p><script>evil()</script><img src="//d.bmcx.com/shouyu/_file/a/example.png" alt="手语测试词">'
  result=c.parse_page(html,c.ORIGIN+'/10__shouyud/')
  self.assertEqual(result['term'],'测试词');self.assertNotIn('说明',str(result));self.assertNotIn('evil',str(result))
  self.assertEqual(result['referenceImageUrls'],['https://d.bmcx.com/shouyu/_file/a/example.png'])
 def test_index_only_follows_dictionary_paths(self):
  result=c.parse_page('<a href="/10__shouyud/"><strong>测试</strong></a><a href="https://evil.example/20__shouyud/">危险</a><a href="javascript:alert(1)">脚本</a><a href="/login/">登录</a>',c.ORIGIN+'/')
  self.assertEqual(result['links'],[{'url':c.ORIGIN+'/10__shouyud/','text':'测试'}])
 def test_ambiguous_detail_rejected(self):
  for html in ['<title>验证码</title>','<title>未知页面</title>','<title>测试的手语 - 测试</title><link rel="canonical" href="https://evil.example/10__shouyud/">','<title>测试的手语 - 测试</title><link rel="canonical" href="https://shouyu.bmcx.com/20__shouyud/">']:
   with self.subTest(html=html),self.assertRaises(ValueError):c.parse_page(html,c.ORIGIN+'/10__shouyud/')
 def test_network_allowlist(self):
  for url in ['http://shouyu.bmcx.com/','https://shouyu.bmcx.com.evil/','https://shouyu.bmcx.com/private','https://shouyu.bmcx.com/?q=anything','https://user:pass@shouyu.bmcx.com/','https://shouyu.bmcx.com/10__shouyud/#foo']:
   with self.subTest(url=url),self.assertRaises(ValueError):c.allowed_url(url)
 def test_robots_restriction_precedes_cache(self):
  f=c.Fetcher();f.robot=RobotFileParser();f.robot.parse(['User-agent: *','Disallow: /'])
  with self.assertRaisesRegex(ValueError,'robots'):f.get(c.ORIGIN+'/10__shouyud/')
 def test_repeated_links_deduplicate_by_url_not_word(self):
  result=c.parse_page('<a href="/10__shouyud/">词</a><a href="/10__shouyud/">词</a><a href="/11__shouyud/">词</a>',c.ORIGIN+'/')
  self.assertEqual(len(result['links']),2)

if __name__=='__main__':unittest.main()
