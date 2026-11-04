/* Egypt Atlas v0.23 — polite nearby-tour suggestions. Explicit opt-in, foreground only.
   Coordinates never leave the device: all distances are calculated against the catalog. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const R=6371000;
 const rad=x=>x*Math.PI/180;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const distance=(a,b)=>{
   const la1=rad(a[1]),la2=rad(b[1]),dLa=la2-la1,dLo=rad(b[0]-a[0]);
   const h=Math.sin(dLa/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2;
   return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
 };
 let active=false, watchId=null, position=null, accuracy=null, dismissed=new Set();
 const demoTourId=new URLSearchParams(window.location.search).get('demo-nearby');
 let demoAnchor=null;
 let getTours=()=>[],getActiveId=()=>null,openTour=()=>{};
 function anchors(t){
   const pts=Object.values(t.map?.geoPoints||{}).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)).map(p=>[p.lng,p.lat]);
   const center=t.map?.center;
   if(pts.length===0 && Array.isArray(center))pts.push(center);
   return pts;
 }
 function matches(lon,lat){
   const user=[lon,lat];
   return getTours().filter(t=>t.map).map(t=>{
     const ds=anchors(t).map(p=>distance(user,p));
     return {tour:t,meters:ds.length?Math.min(...ds):Infinity,radius:t.map.nearbyRadiusMeters||450};
   }).filter(m=>m.meters<=m.radius).sort((a,b)=>a.meters-b.meters);
 }
 function showButton(){
   const btn=$('nearby-toggle');if(!btn)return;
   btn.setAttribute('aria-pressed',String(active));
   btn.textContent=active?'◎ Подсказки включены':'⌖ Экскурсии рядом';
 }
 function status(message){const el=$('nearby-status');if(el)el.textContent=message;}
 function render(){
   showButton();const area=$('nearby-suggestion');
   if(!area)return;
   if(!active||!position||!Number.isFinite(accuracy)||accuracy>250){area.hidden=true;area.innerHTML='';return;}
   const candidates=matches(position[0],position[1]);
   // A dismiss lasts while the user remains in the site's vicinity. When they
   // leave the area, a future visit may suggest it again.
   for(const id of [...dismissed]){
     const match=candidates.find(x=>x.tour.id===id);
     if(!match) dismissed.delete(id);
   }
   const suggestions=candidates.filter(x=>x.tour.id!==getActiveId()&&!dismissed.has(x.tour.id)).slice(0,2);
   if(suggestions.length===0){area.hidden=true;area.innerHTML='';return;}
   area.hidden=false;
   area.innerHTML='<div class="nearby-suggest-header"><span>⌖ ПОДСКАЗКА ПО МЕСТУ</span><button type="button" data-close aria-label="Скрыть подсказку">×</button></div>'+
    suggestions.map(m=>`<div class="nearby-suggest-row"><div><strong>${esc(m.tour.title)}</strong><p>Рядом с точками экскурсии · ≈ ${Math.max(10,Math.round(m.meters/10)*10)} м до ориентира</p></div><button type="button" class="nearby-open-tour" data-tour="${esc(m.tour.id)}">Открыть →</button></div>`).join('')+
    '<p class="nearby-privacy">Расстояние приблизительное, особенно внутри зданий. Данные GPS остаются на устройстве.</p>';
   area.querySelector('[data-close]').addEventListener('click',()=>{suggestions.forEach(x=>dismissed.add(x.tour.id));render();});
   area.querySelectorAll('[data-tour]').forEach(btn=>btn.addEventListener('click',()=>{
     const id=btn.dataset.tour;dismissed.add(id);openTour(id);render();
   }));
 }
 function onPosition(p){
   if(!active)return;
   const {latitude,longitude,accuracy:reported}=p.coords;
   if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
   position=[longitude,latitude];accuracy=Number.isFinite(reported)?reported:Infinity;
   if(accuracy>250)status(`Геопозиция неточная (±${Math.round(accuracy)} м). Подсказки пока скрыты.`);
   else {
     const near=matches(longitude,latitude);
     status(near.length?(near.some(x=>x.tour.id!==getActiveId())?'Поблизости есть экскурсии':'Вы рядом с открытой экскурсией'):'Поблизости пока нет экскурсий');
   }
   render();
 }
 function onError(e){
   if(e.code===1){stop();status('Доступ к геопозиции запрещён. Разрешите его в настройках браузера.');}
   else status('Не получилось определить местоположение. Можно попробовать позже.');
 }
 function clearWatch(){if(watchId!==null && navigator.geolocation){navigator.geolocation.clearWatch(watchId);watchId=null;}}
 function watch(){
   if(!active||document.hidden||watchId!==null)return;
   status('Определяем ваше местоположение…');
   try{watchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:false,maximumAge:15000,timeout:20000});}
   catch(_){stop();status('Не удалось включить GPS. Проверьте разрешения браузера.');}
 }
 function stop(){active=false;clearWatch();position=null;accuracy=null;render();}
 function toggle(){
   if(active){stop();status(demoAnchor?'ДЕМО выключено':'Поиск экскурсий рядом выключен');return;}
   if(demoAnchor){
     // Explicit URL opt-in for testing on iPhone outside Egypt. No OS GPS request.
     active=true;
     position=[demoAnchor[0]+0.0012,demoAnchor[1]]; // ~100–120m east of the point
     accuracy=15;
     status('ДЕМО: положение возле достопримечательности смоделировано, GPS не используется.');
     render();
     return;
   }
   if(!navigator.geolocation||!window.isSecureContext){status('Геоподсказки доступны в PWA через HTTPS или localhost.');return;}
   active=true;render();watch();
 }
 function setup(options){
   getTours=options.getTours;getActiveId=options.getActiveId;openTour=options.openTour;
   if(demoTourId){
     const tour=getTours().find(t=>t.id===demoTourId);
     demoAnchor=tour?.map?.center || null;
     if(demoAnchor)status(`ДЕМО для ${tour.title}: нажмите «Экскурсии рядом». Реальный GPS не используется.`);
   }
   $('nearby-toggle')?.addEventListener('click',toggle);
   document.addEventListener('visibilitychange',()=>{
     if(document.hidden){clearWatch();position=null;accuracy=null;render();}
     else if(active){
       if(demoAnchor){position=[demoAnchor[0]+0.0012,demoAnchor[1]];accuracy=15;render();}
       else watch();
     }
   });
   render();
 }
 window.EgyptAtlasNearby={setup,refresh:render,stop};
})();
