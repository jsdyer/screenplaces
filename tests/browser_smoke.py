"""Screen Places UI checks at the project subpath; external details mocked."""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import json,shutil,tempfile,threading
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
def main():
 shots=ROOT/'browser-checks';shots.mkdir(exist_ok=True)
 with tempfile.TemporaryDirectory() as tmp:
  shutil.copytree(ROOT/'dist',Path(tmp)/'screenplaces');server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=tmp));threading.Thread(target=server.serve_forever,daemon=True).start()
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://tile.openstreetmap.org/**',lambda r:r.abort())
    page.route('https://coolcode-visitor-api.jeffdyer.workers.dev/api/screenplaces/**',lambda r:r.fulfill(content_type='application/json',headers={'access-control-allow-origin':'*'},body=json.dumps({'fetched_at':'2026-11-25T00:00:00Z','data':{'title':'The X-Files','overview':'Film details test response','rating':8.4,'rating_count':100,'tmdb_url':'https://www.themoviedb.org/tv/4087'}})))
    page.goto(f'http://127.0.0.1:{server.server_port}/screenplaces/');page.locator('.card').first.wait_for();assert page.locator('.card').count()>1
    page.locator('#query').fill('The X-Files');assert page.locator('.card').count()>=1
    page.locator('.card button',has_text='Save location').first.click();assert page.locator('#saved-list li').count()==1
    page.reload();page.locator('.card').first.wait_for();assert page.locator('#saved-list li').count()==1
    page.locator('#precision').select_option('venue');assert page.locator('.card').count()>0;assert page.locator('.card:not(.venue)').count()==0
    page.locator('.card button',has_text='Film details').first.click();page.get_by_text('Film details test response',exact=True).wait_for();page.locator('#close-details').click()
    page.locator('#region').select_option('halifax');assert 'Halifax' in page.locator('#status').inner_text()
    page.screenshot(path=str(shots/'desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(shots/'mobile.png'),full_page=True)
    assert not errors,errors;browser.close()
  finally:server.shutdown()
 print('Screen Places browser checks passed')
if __name__=='__main__':main()
