(() => {
'use strict';
const form=document.getElementById('ai-lot-form');if(!form)return;
const q=document.getElementById('ai-query'),source=document.getElementById('ai-source'),limit=document.getElementById('ai-limit'),status=document.getElementById('ai-status'),button=document.getElementById('ai-submit'),links=document.getElementById('ai-links'),results=document.getElementById('ai-results'),cards=document.getElementById('ai-cards');
const hosts=['bankrot.fedresurs.ru','torgi.gov.ru','lot-online.ru','m-ets.ru'];
let searchReady=false;
function safeUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}}
function el(type,value){const n=document.createElement(type);if(value!=null)n.textContent=String(value);return n;}
function notice(message,error){status.textContent=message;status.dataset.error=error?'true':'false';}
function setSearchReady(ready){
searchReady=ready;
for(const control of [q,source,limit])control.disabled=!ready;
button.disabled=!ready;
button.textContent=ready?'Найти предварительные публикации':'Автоматический поиск недоступен';
}
function renderLinks(text){
const arr=[['ЕФРСБ — официальный реестр','https://bankrot.fedresurs.ru/'],['ГИС Торги — официальный реестр','https://torgi.gov.ru/']];
if(text){arr.push(['Поиск по ЕФРСБ в Яндексе — непроверенные результаты','https://yandex.ru/search/?text='+encodeURIComponent('site:bankrot.fedresurs.ru '+text)]);arr.push(['Поиск по ГИС Торги в Яндексе — непроверенные результаты','https://yandex.ru/search/?text='+encodeURIComponent('site:torgi.gov.ru '+text)]);}
links.replaceChildren();for(const [name,url] of arr){const a=el('a',name+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
}
q.addEventListener('input',()=>renderLinks(q.value.trim().slice(0,400)));
form.addEventListener('submit',async e=>{
e.preventDefault();const query=q.value.trim();
if(!searchReady){notice('Автоматический поиск не включён. Используйте первоисточники ниже.',true);return;}
if(query.length<12||query.length>400){notice('Введите запрос от 12 до 400 символов.',true);return;}
renderLinks(query);button.disabled=true;results.hidden=true;cards.replaceChildren();notice('Проверяем доступность поиска…');
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
try{
const response=await fetch('/api/ai-lot-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,source:source.value,limit:Number(limit.value)}),signal:controller.signal,cache:'no-store'});
const data=await response.json().catch(()=>({}));
if(!response.ok||data.ok!==true||!Array.isArray(data.lots))throw new Error('Автоматический поиск пока не подключён. Откройте источники ниже.');
let count=0;
for(const lot of data.lots.slice(0,10)){
const url=safeUrl(lot?.url);if(!url||typeof lot.title!=='string')continue;
const card=el('article');card.className='ai-card';card.append(el('h3',lot.title.slice(0,160)));
if(lot.region)card.append(el('p','Регион: '+String(lot.region).slice(0,100)));
if(Number.isFinite(lot.price_rub))card.append(el('p','Цена по публикации (проверьте): '+new Intl.NumberFormat('ru-RU').format(lot.price_rub)+' ₽'));
if(lot.deadline)card.append(el('p','Срок заявки (проверьте): '+String(lot.deadline).slice(0,60)));
if(lot.summary)card.append(el('p',String(lot.summary).slice(0,300)));
card.append(el('p','Статус торгов и актуальность не подтверждены.'));
const a=el('a','Открыть источник ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);
const p=el('p');const verify=el('a','Заказать проверку');verify.href='/proverka-lota/';p.append(verify);card.append(p);cards.append(card);count++;
}
results.hidden=false;document.getElementById('ai-results-title').textContent=count?'Найдено публикаций: '+count:'Подтверждаемых публикаций не найдено';
document.getElementById('ai-results-caption').textContent='Поиск: '+(data.retrieved_at||'время неизвестно')+'. Сведения предварительные; проверьте на сайте первоисточника.';
notice(count?'Подборка сформирована. Перед участием проверьте документы и условия.':'Нет подтверждаемых кандидатов по заданным параметрам.');
}catch(err){notice(err?.name==='AbortError'?'Время поиска истекло. Откройте первоисточники ниже.':err.message||'Сервис недоступен.',true);}
finally{clearTimeout(timer);button.disabled=false;}
});
async function checkAvailability(){
try{
const response=await fetch('/api/ai-lot-search',{method:'GET',headers:{'Accept':'application/json'},cache:'no-store'});
const data=await response.json().catch(()=>({}));
if(data.enabled===true){setSearchReady(true);notice('Автоматический поиск включён. Введите только публичные критерии; результаты предварительные и требуют проверки.');return;}
}catch{}
setSearchReady(false);
notice('Автоматический поиск пока не включён. Можно искать в первоисточниках ниже; текст запроса не отправляется.',false);
}
checkAvailability();
})();
