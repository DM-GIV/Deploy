#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from urllib.request import urlopen
from urllib.error import HTTPError
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import sys
P=Path('/home/deploy/torgatlas-site-catalogue/public')
assert P.is_dir()
class Links(HTMLParser):
    def __init__(self):
        super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        for key in ('href','src'):
            x=d.get(key,'')
            if x.startswith('/'):
                self.links.append(x)
broken=[]
html=list(P.rglob('*.html'))
for f in html:
    p=Links();p.feed(f.read_text(encoding='utf8'))
    for u in p.links:
        part=urlsplit(u)
        dest=P/unquote(part.path).lstrip('/')
        if part.path=='/': continue
        if dest.is_file() or (dest.is_dir() and (dest/'index.html').is_file()): continue
        broken.append((str(f.relative_to(P)),part.path))
assert not broken, 'broken internal links: '+str(broken[:30])
for forbidden in ('ai-poisk-lotov','primery-lotov'):
    assert not (P/forbidden).exists()
home=(P/'index.html').read_text(encoding='utf8')
assert '/ai-poisk-lotov/' not in home and '/primery-lotov/' not in home
assert 'RESEARCH_SHOWCASE_START' not in home and 'weekly-lots.js' not in home
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(P)))
port=server.server_address[1]
th=Thread(target=server.serve_forever,daemon=True);th.start()
try:
    for uri in ('/','/privacy/','/blog/','/poisk-imushchestva/','/proverka-lota/','/o-torgatlas/','/oplata-uslug/','/robots.txt','/sitemap.xml','/assets/home-bundle.css'):
        with urlopen('http://127.0.0.1:'+str(port)+uri,timeout=4) as resp:
            body=resp.read()
            assert resp.status==200 and len(body)>80,(uri,resp.status)
    for uri in ('/ai-poisk-lotov/','/primery-lotov/','/api/ai-lot-search'):
        try:
            urlopen('http://127.0.0.1:'+str(port)+uri,timeout=4)
        except HTTPError as err:
            assert err.code==404,(uri,err.code)
        else:
            raise AssertionError('forbidden route worked: '+uri)
finally:
    server.shutdown();server.server_close()
print('PASS local HTTP pages=10 routes_disabled=3 html='+str(len(html))+' links_checked=PASS')
