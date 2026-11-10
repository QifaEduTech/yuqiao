from pathlib import Path
import importlib.util
import unittest
spec=importlib.util.spec_from_file_location('enrich',Path(__file__).resolve().parents[1]/'scripts/enrich-sign-dictionary.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class DescriptionTests(unittest.TestCase):
 def test_only_target_cell_and_all_variant_markers(self):
  html='<table><tr><td><table><tr><td><strong>词</strong><br>（一）动作甲。<br>（二）动作乙。<script>不要采集脚本</script></td><td><img alt="词"></td></tr></table></td></tr></table><td><strong>广告</strong>忽略这段</td>'
  self.assertEqual(module.extract_description(html,'词'),'（一）动作甲。 （二）动作乙。')
 def test_ambiguous_or_missing_cells_fail(self):
  for html in ['<p>没有目标词</p>','<td><strong>词</strong>第一种说明。</td><td><strong>词</strong>第二种说明。</td>']:
   with self.assertRaises(ValueError):module.extract_description(html,'词')
 def test_media_origin_is_bounded(self):
  for url in ['http://d.bmcx.com/shouyu/_file/c/ed9305275555e84d.png','https://evil.example/shouyu/_file/c/ed9305275555e84d.png','https://d.bmcx.com/private.png','https://d.bmcx.com/shouyu/_file/c/ed9305275555e84d.png?q=1']:
   with self.assertRaises(ValueError):module.image_url(url)

if __name__=='__main__':unittest.main()
