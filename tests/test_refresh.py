import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
P=Path(__file__).resolve().parents[1];spec=importlib.util.spec_from_file_location('refresh',P/'scripts/refresh.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RefreshTests(unittest.TestCase):
 def setUp(self):
  self.config=json.loads((P/'web/config.json').read_text());self.region=self.config['regions'][0]
  self.row={'work':{'value':'http://www.wikidata.org/entity/Q2744'},'workLabel':{'value':'The X-Files'},'place':{'value':'http://www.wikidata.org/entity/Q24639'},'placeLabel':{'value':'Vancouver'},'coord':{'value':'Point(-123.1 49.2)'},'tmdbTV':{'value':'4087'}}
 def test_real_statement_normalization_and_precision(self):
  rows=m.normalize([self.row,self.row],self.region,self.config);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['precision'],'city');self.assertEqual(rows[0]['type'],'tv');self.assertIsNone(rows[0]['year'])
 def test_unreviewed_place_stays_unclassified(self):
  row={**self.row,'place':{'value':'http://www.wikidata.org/entity/Q999999'}};self.assertEqual(m.normalize([row],self.region,self.config)[0]['precision'],'unclassified')
 def test_invalid_coordinates_fail_before_publication(self):
  with self.assertRaises(ValueError):m.normalize([{**self.row,'coord':{'value':'Point(0 91)'}}],self.region,self.config)
 def test_add_region_and_use_source_dates_not_build_dates(self):
  config={**self.config,'regions':[self.region,{**self.region,'id':'added','name':'Additional area'}]};cached={r['id']:{'results':{'bindings':[self.row]}} for r in config['regions']}
  with patch.object(m,'release_years',return_value={'Q2744':1993}):data=m.collect(config,cached)
  self.assertEqual(len(data['regions']),2);self.assertEqual(data['records'][1]['year'],1993)
 def test_missing_empty_truncated_inputs_rejected(self):
  for value in [{},{'results':{'bindings':[]}}, {'results':{'bindings':[self.row]*self.config['result_limit']}}]:
   with self.assertRaises(ValueError):m.collect({**self.config,'regions':[self.region]},{self.region['id']:value})
 def test_explicit_empty_region_is_preserved_with_zero_coverage(self):
  region={**self.region,'allow_empty':True};config={**self.config,'regions':[region]}
  with patch.object(m,'release_years',return_value={}):data=m.collect(config,{region['id']:{'results':{'bindings':[]}}})
  self.assertEqual(data['regions'][0]['records'],0)
 def test_partitioned_publication_preserves_manifest_on_write_failure(self):
  row=m.normalize([self.row],self.region,self.config)[0]
  snapshot={'schema':'screenplaces.v1','fetched_at':'2026-11-25T00:00:00Z','regions':[{**self.region,'records':1,'productions':1,'places':1}],'records':[row]}
  with tempfile.TemporaryDirectory()as tmp:
   web=Path(tmp);manifest=m.publish_partitioned(snapshot,web);before=(web/'data/catalogue.json').read_bytes();file=web/manifest['regions'][0]['records_url'][2:];self.assertTrue(file.exists())
   newer={**snapshot,'fetched_at':'2026-11-26T00:00:00Z'}
   with patch.object(Path,'write_bytes',side_effect=OSError('disk full')):
    with self.assertRaises(OSError):m.publish_partitioned(newer,web)
   self.assertEqual((web/'data/catalogue.json').read_bytes(),before);self.assertTrue(file.exists())
 def test_bounds_validated(self):
  with self.assertRaises(ValueError):m.query_region({**self.region,'bounds':[-180,0,181,10]},100)
if __name__=='__main__':unittest.main()
