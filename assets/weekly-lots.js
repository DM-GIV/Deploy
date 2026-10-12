/* Weekly rotation of published, previously researched auction cases.
   No external crawl on a visitor request; no estimated market discount without
   independent priced comparables. Source snapshots are Sep–Oct 2026. */
(function () {
  'use strict';
  const cases = [
    {id:'atc-13145',title:'Hyundai ix55, 2012 год',kind:'Автомобиль',price:'923 737,50 ₽',url:'https://atctrade.ru/trade/view/purchase/general.html?id=105491275'},
    {id:'atc-13144',title:'Земельный участок 1 040 м², Московская область',kind:'Участок',price:'554 400 ₽',url:'https://atctrade.ru/trade/view/purchase/general.html?id=105490686'},
    {id:'atc-13152',title:'Жилое помещение, открытый аукцион',kind:'Жилая недвижимость',price:'4 575 600 ₽',url:'https://atctrade.ru/trade/view/purchase/general.html?id=105493145'},
    {id:'atc-13151',title:'Дом с земельным участком',kind:'Составной лот',price:'5 237 800 ₽',url:'https://atctrade.ru/trade/view/purchase/general.html?id=105492993'},
    {id:'ver-3004',title:'Дом 111,7 м² и участок около 700 м²',kind:'Недвижимость',price:'7 977 005,24 ₽',url:'https://bankrot.vertrades.ru/showTrades?id=700848293'},
    {id:'ver-2976',title:'Электропогрузчики Toyota 7FBE15',kind:'Оборудование',price:'52 650 ₽',url:'https://bankrot.vertrades.ru/showTrades?id=700837242'},
    {id:'ru-100004279',title:'Участок 1 000 ± 22 м² для садоводства',kind:'Участок',price:'350 000 ₽',url:'https://ru-trade24.ru/bidding/AnounsmentDetails/100004279'}
  ];
  function isoWeekNumber(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const start = new Date(Date.UTC(t.getUTCFullYear(),0,1));
    return Math.ceil((((t-start)/86400000)+1)/7);
  }
  function weeklySelection(d) {
    const week=isoWeekNumber(d);
    const year=d.getUTCFullYear();
    const start=((year*53+week)*3)%cases.length;
    return [cases[start],cases[(start+1)%cases.length],cases[(start+2)%cases.length]];
  }
  function el(tag,cls,content) {
    const out=document.createElement(tag);
    if(cls)out.className=cls;
    if(content!==undefined)out.textContent=content;
    return out;
  }
  function render() {
    const container=document.getElementById('weekly-lot-showcase');
    if(!container)return;
    const picks=weeklySelection(new Date());
    const grid=el('div','research-case-grid');
    picks.forEach(function(item){
      const article=el('article','research-case-card');
      const top=el('div','research-case-top');
      top.append(el('span','research-case-category',item.kind),el('span','research-case-n','Исследование · 2026'));
      const inner=el('div','research-case-inner');
      inner.append(el('h3','',item.title),el('div','research-case-price-label','Цена на дату исследования'),el('div','research-case-price',item.price));
      inner.append(el('p','research-case-mode','Исторический пример: актуальность торгов уточняется по источнику.'));
      inner.append(el('p','','Дисконт к рыночной цене не оценён: нужны подтверждённые сопоставимые предложения.'));
      const a=el('a','research-case-link','Открыть первоисточник ↗');
      a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
      inner.append(a);article.append(top,inner);grid.append(article);
    });
    container.replaceChildren(grid);
    const info=document.getElementById('weekly-lots-note');
    if(info)info.textContent='Примеры меняются автоматически раз в неделю из проверяемой подборки семи исторических публикаций. Ни рыночная скидка, ни текущая доступность лота этим не подтверждаются.';
  }
  if (typeof module!=='undefined' && module.exports) module.exports={weeklySelection,cases,isoWeekNumber};
  if (typeof document!=='undefined') {
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{once:true});
    else render();
  }
})();