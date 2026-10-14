#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/home/deploy/.aa-pw-pkg/playwright/driver/package/index.js';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace(/<link rel="stylesheet"[^>]*>/g,'')
  .replace(/<script src="[^"]+"[^>]*><\/script>/g,'');
const css=fs.readFileSync(path.join(root,'assets/home-bundle.css'),'utf8');
const documentHtml=html.replace('</head>',`<style>${css}</style></head>`);
const browser=await playwright.chromium.launch({headless:true,executablePath:'/home/deploy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
const widths=[1440,768,390];
const results=[];
for(const width of widths){
  const page=await browser.newPage({viewport:{width,height:1000},locale:'ru-RU'});
  await page.setContent(documentHtml,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(()=>{
    const grid=document.querySelector('.rotation-case-grid');
    const cards=[...document.querySelectorAll('.rotation-case-card')];
    return {cards:cards.length,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>window.innerWidth,unnamedLinks:cards.flatMap(card=>[...card.querySelectorAll('a')]).filter(link=>!link.textContent.trim()).length};
  });
  results.push({width,...result,status:result.cards===8&&result.columns===(width===1440?4:width===768?2:1)&&!result.overflow&&!result.unnamedLinks?'PASS':'FAIL'});
  await page.close();
}
await browser.close();
const report={schema:'torgatlas-research-showcase-browser-v1',results};
const output=process.argv[2]||'docs/torgatlas-growth/evidence/RESEARCH_SHOWCASE_BROWSER_2026-10-15.json';
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(results.some(row=>row.status!=='PASS'))process.exitCode=1;
