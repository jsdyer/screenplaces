#!/usr/bin/env python3
"""Refresh documented Wikidata filming statements atomically; preserve good data on failure."""
import argparse, datetime as dt, json, math, re, time, urllib.parse, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
UA='CoolCode-Screenplaces/1.0 (+https://coolcode.ca/screenplaces/; public filming-location catalogue)'
QID=re.compile(r'Q[1-9]\d{0,11}')
def request_json(url):
    last=None
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/sparql-results+json, application/json'})
            with urllib.request.urlopen(req,timeout=75) as response:
                blob=response.read(12_000_001)
            if len(blob)>12_000_000:raise ValueError('Source response exceeds 12 MB')
            return json.loads(blob)
        except Exception as exc:
            last=exc
            if attempt<2:time.sleep(2*(attempt+1))
    raise RuntimeError('Wikidata source request failed; previous catalogue retained') from last

def sparql(query):
    return request_json('https://query.wikidata.org/sparql?'+urllib.parse.urlencode({'query':query,'format':'json'}))
def query_region(region,limit):
    b=region.get('bounds')
    if not isinstance(b,list) or len(b)!=4 or not all(isinstance(n,(int,float)) and math.isfinite(n) for n in b) or not(-180<=b[0]<b[2]<=180 and -90<=b[1]<b[3]<=90):raise ValueError('Invalid region bounds')
    return f'''SELECT DISTINCT ?work ?workLabel ?place ?placeLabel ?coord ?tmdbMovie ?tmdbTV WHERE {{
 SERVICE wikibase:box {{ ?place wdt:P625 ?coord . bd:serviceParam wikibase:cornerWest "Point({b[0]} {b[1]})"^^geo:wktLiteral . bd:serviceParam wikibase:cornerEast "Point({b[2]} {b[3]})"^^geo:wktLiteral . }}
 ?work wdt:P915 ?place . OPTIONAL {{ ?work wdt:P4947 ?tmdbMovie }} OPTIONAL {{ ?work wdt:P4983 ?tmdbTV }}
 SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,mul,fr" }} }} LIMIT {limit}'''

def normalize(bindings,region,config):
    if not isinstance(bindings,list):raise ValueError('Missing result bindings')
    precision={qid:key for key,ids in config['precision'].items() for qid in ids}
    rows={}
    for b in bindings:
        work=b.get('work',{}).get('value','').rsplit('/',1)[-1];place=b.get('place',{}).get('value','').rsplit('/',1)[-1]
        if not QID.fullmatch(work) or not QID.fullmatch(place):raise ValueError('Invalid entity ID')
        match=re.fullmatch(r'Point\((-?[\d.]+) (-?[\d.]+)\)',b.get('coord',{}).get('value',''))
        if not match:raise ValueError('Missing or invalid location coordinate')
        lon,lat=map(float,match.groups())
        if not(-90<=lat<=90 and -180<=lon<=180):raise ValueError('Out-of-range coordinates')
        rows[f'{work}@{place}']={'id':f'{work}@{place}','work_id':work,'title':b.get('workLabel',{}).get('value',work),'place_id':place,'place':b.get('placeLabel',{}).get('value',place),'lat':lat,'lon':lon,'year':None,'type':'tv' if b.get('tmdbTV') else 'movie' if b.get('tmdbMovie') else 'unknown','region':region['id'],'precision':precision.get(place,'unclassified'),'source_url':f'https://www.wikidata.org/wiki/{work}#P915','location_url':f'https://www.wikidata.org/wiki/{place}'}
    return list(rows.values())

def fill_missing_labels(rows):
    ids=sorted({r['work_id'] for r in rows if QID.fullmatch(r['title'])})
    labels={}
    for start in range(0,len(ids),50):
        u='https://www.wikidata.org/w/api.php?'+urllib.parse.urlencode({'action':'wbgetentities','ids':'|'.join(ids[start:start+50]),'props':'labels','languages':'en|mul|fr|de|es','languagefallback':'1','format':'json'})
        response=request_json(u)
        if not isinstance(response.get('entities'),dict):raise ValueError('Entity labels response is invalid')
        for qid,entity in response['entities'].items():
            available=entity.get('labels',{})
            label=next((available[lang]['value'] for lang in ['en','mul','fr','de','es'] if available.get(lang)),None)
            if label:labels[qid]=label
    for row in rows:
        if row['work_id'] in labels and QID.fullmatch(row['title']):row['title']=labels[row['work_id']]


def release_years(ids):
    out={};ids=sorted(set(ids))
    for start in range(0,len(ids),100):
        batch=ids[start:start+100]
        if not all(QID.fullmatch(i) for i in batch):raise ValueError('Invalid work ID')
        query='SELECT ?work (MIN(?released) AS ?date) WHERE { VALUES ?work { '+ ' '.join('wd:'+i for i in batch)+' } ?work wdt:P577 ?released . } GROUP BY ?work'
        response=sparql(query)
        bindings=response.get('results',{}).get('bindings')
        if not isinstance(bindings,list):raise ValueError('Release-date source response is invalid')
        for row in bindings:
            q=row['work']['value'].rsplit('/',1)[-1];m=re.match(r'^(\d{4})-',row.get('date',{}).get('value',''))
            if m:out[q]=int(m.group(1))
    return out

def collect(config,cached=None):
    limit=config.get('result_limit',2000)
    if not isinstance(limit,int) or not 10<=limit<=10000:raise ValueError('result_limit must be 10–10000')
    if not config.get('regions'):raise ValueError('Configure at least one region')
    allrows=[];coverage=[]
    for region in config['regions']:
        print('Collecting',region['name'],flush=True)
        raw=cached[region['id']] if cached else sparql(query_region(region,limit))
        bindings=raw.get('results',{}).get('bindings')
        if bindings is None or len(bindings)>=limit:raise ValueError('Source results missing or truncated; increase result_limit or narrow bounds')
        rows=normalize(bindings,region,config)
        if not rows:raise ValueError('A configured region returned no records; inspect source before replacing good data')
        allrows.extend(rows);coverage.append({**region,'records':len(rows),'productions':len({r['work_id'] for r in rows})})
    fill_missing_labels(allrows)
    years=release_years(r['work_id'] for r in allrows)
    for row in allrows:row['year']=years.get(row['work_id'])
    now=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
    return {'schema':'screenplaces.v1','fetched_at':now,'source':'Wikidata P915 (filming location), P625 (coordinates), P577 (earliest listed release date)','licence':'CC0','regions':coverage,'records':sorted(allrows,key=lambda r:(r['title'].casefold(),r['place']))}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cached-inputs',help='Directory of already retrieved raw region responses, for initial import');args=parser.parse_args()
    config=json.loads((ROOT/'web/config.json').read_text());cached=None
    if args.cached_inputs:cached={r['id']:json.loads((Path(args.cached_inputs)/('screenplaces-'+r['id']+'-locations.json')).read_text()) for r in config['regions']}
    snapshot=collect(config,cached);target=ROOT/'web/data/catalogue.json';target.parent.mkdir(parents=True,exist_ok=True)
    stage=target.with_suffix('.json.tmp');stage.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n');stage.replace(target)
    print('Published',len(snapshot['records']),'location statements at',snapshot['fetched_at'])
if __name__=='__main__':main()
