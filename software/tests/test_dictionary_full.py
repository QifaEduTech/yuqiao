import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('full',Path(__file__).resolve().parents[1]/'scripts/crawl-dictionary-full.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
class FullTests(unittest.TestCase):
 def fixture(self,extra=''):
  return '<title>社交类手语 - 手语大全</title><table><tr><td><table><tr><td><a href="/1__shouyud/"><strong>测试</strong></a><br>（一）动作甲。（二）动作乙。</td><td><img src="//d.bmcx.com/shouyu/_file/a/12345678.png" alt="手语测试"></td></tr></table></td></tr></table><a href="/社交_7__shouyul/">尾页</a>'+extra
 def test_extract_listing_and_pagination(self):
  terms,last=f.parse_listing(self.fixture(),f.c.ORIGIN+'/%E7%A4%BE%E4%BA%A4_1__shouyul/','社交');self.assertEqual(last,7);self.assertEqual(len(terms),1);self.assertEqual(terms[0]['description'],'（一）动作甲。（二）动作乙。');self.assertEqual(terms[0]['imageUrls'],['https://d.bmcx.com/shouyu/_file/a/12345678.png'])
 def test_unparsed_word_prevents_false_page_completion(self):
  with self.assertRaises(ValueError):f.parse_listing(self.fixture('<a href="/2__shouyud/">丢失词</a>'),f.c.ORIGIN+'/','社交')
 def test_wrong_category_and_oversized_pagination_rejected(self):
  with self.assertRaises(ValueError):f.parse_listing(self.fixture(),f.c.ORIGIN+'/','时间')
  with self.assertRaises(ValueError):f.parse_listing(self.fixture('<a href="/社交_9999__shouyul/">尾页</a>'),f.c.ORIGIN+'/','社交')
 def test_missing_description_is_explicit_not_invented(self):
  terms,_=f.parse_listing(self.fixture().replace('（一）动作甲。（二）动作乙。',''),f.c.ORIGIN+'/','社交');self.assertEqual(terms[0]['descriptionStatus'],'missing_at_source')
 def test_placeholder_image_is_a_source_gap_not_a_failed_page(self):
  terms,_=f.parse_listing(self.fixture().replace('/a/12345678.png','/no_picture.png'),f.c.ORIGIN+'/','社交');self.assertEqual(terms[0]['imageUrls'],[]);self.assertEqual(terms[0]['imageStatus'],'missing_at_source')
 def test_unicode_pagination_is_encoded_and_origin_bounded(self):
  self.assertEqual(f.normalized_url('https://shouyu.bmcx.com/社交_2__shouyul/'),'https://shouyu.bmcx.com/%E7%A4%BE%E4%BA%A4_2__shouyul/')
  with self.assertRaises(ValueError):f.normalized_url('https://evil.example/社交_2__shouyul/')
 def test_real_previous_page_parser(self):
  path=Path(__file__).resolve().parents[1]/'.runtime-logs/dictionary-source-check/social.html'
  if not path.exists():self.skipTest('No local previously verified fixture')
  terms,last=f.parse_listing(path.read_text(encoding='utf-8-sig'),f.c.ORIGIN+'/%E7%A4%BE%E4%BA%A4_1__shouyul/','社交');self.assertEqual(len(terms),20);self.assertEqual(last,7);self.assertTrue(all(t['description'] and t['imageUrls'] for t in terms))
if __name__=='__main__':unittest.main()
