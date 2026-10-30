import sys, json
from playwright.sync_api import sync_playwright
base='http://localhost:8899'
tokens=sys.argv[1:] or ['demo','demo-calls']
views=['overview','weekly','trends','campaigns','audiences','videos','ads','insights']
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    for tok in tokens:
        pg=b.new_page(viewport={'width':1280,'height':900})
        pg.on('console', lambda m: errs.append((tok,'console',m.text)) if m.type=='error' else None)
        pg.on('pageerror', lambda e: errs.append((tok,'pageerror',str(e))))
        pg.goto(f'{base}/?k={tok}')
        pg.wait_for_selector('.kpi', timeout=8000)
        for v in views:
            pg.click(f'#nav button[data-go="{v}"]')
            pg.wait_for_timeout(150)
            txt=pg.inner_text('#view')
            bad=[w for w in ('undefined','NaN','Infinity','[object') if w in txt]
            print(tok,v,len(txt),'BAD:'+','.join(bad) if bad else 'ok')
            if v in ('overview','weekly','insights'):
                pg.screenshot(path=f'test/shots/{tok}-{v}.png', full_page=True)
        # date range changes
        for r in ('7','90'):
            pg.click(f'#rangeseg button[data-range="{r}"]'); pg.wait_for_timeout(500)
            txt=pg.inner_text('#view'); print(tok,'range',r,'ok' if 'NaN' not in txt and 'undefined' not in txt else 'BAD')
        pg.click('#rangeseg button[data-range="custom"]'); pg.fill('#cfrom','2026-09-01'); pg.fill('#cto','2026-10-15'); pg.click('#customform .apply'); pg.wait_for_timeout(600)
        print(tok,'custom chip:',pg.inner_text('#rangebar').replace('\n',' | '))
        pg.click('#nav button[data-go="campaigns"]'); pg.click('tr[data-camp]'); pg.wait_for_timeout(200)
        print(tok,'drilldown title:',pg.inner_text('#ttl'))
        pg.close()
    b.close()
print('ERRORS:',json.dumps(errs,indent=1) if errs else 'none')
