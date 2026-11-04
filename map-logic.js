/* Egypt Atlas v0.12: OpenFreeMap / OSM-powered live map.  No coordinates leave app
   until the user authorizes geolocation; browser shares coordinates with OS location services,
   not with the basemap provider directly. Offline scheme remains available without WebGL.
   LIVE map requires internet until fully licensed offline vector packs are implemented. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
// MapLibre GL JS 6.x only ships ESM (.mjs). The old v0.10 URL ended in
// maplibre-gl.js and therefore returned HTTP 404. v5.24 has a UMD build,
// compatible with double-click / file:// local previews.
const LIB_MIRRORS = [
 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/',
 'https://unpkg.com/maplibre-gl@5.24.0/dist/'
];
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
let live = null, markers = [], venueMarker = null, geoMarker = null, accuracy = null, watchId = null;
let selectedTour = null, openCard = null, loadPromise = null, loaded = false, mapMode = 'live';
const setStatus = s => { if ($('map-gps-status')) $('map-gps-status').textContent=s; };
function loadLib() {
 if(window.maplibregl)return Promise.resolve();
 if(loadPromise)return loadPromise;
 const loadFrom=(base)=>new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  const css=document.getElementById('maplibre-css')||document.createElement('link');
  css.id='maplibre-css';css.rel='stylesheet';css.href=base+'maplibre-gl.css';
  if(!css.isConnected)document.head.appendChild(css);
  script.src=base+'maplibre-gl.js';script.async=true;
  let done=false;
  const finish=err=>{if(done)return;done=true;clearTimeout(timer);if(err){script.remove();reject(err);}else resolve();};
  const timer=setTimeout(()=>finish(new Error('Превышено время загрузки MapLibre')),12000);
  script.onload=()=>finish(window.maplibregl?null:new Error('Библиотека карты не экспортировала maplibregl'));
  script.onerror=()=>finish(new Error('CDN недоступен: '+base));
  document.head.appendChild(script);
 });
 loadPromise=(async()=>{
  let last;
  for(const url of LIB_MIRRORS){try{await loadFrom(url);return;}catch(e){last=e;console.warn('MapLibre: пробуем следующий CDN',e.message);}}
  throw last||new Error('Не удалось загрузить MapLibre');
 })().catch(e=>{loadPromise=null;throw e});
 return loadPromise;
}
function fallback(message){
 console.warn('Egypt Atlas map fallback:',message);
 const alert=$('map-fallback-alert');if(alert){alert.textContent=message+' Показана офлайн-схема. Нажмите «Карта OSM», чтобы повторить.';alert.hidden=false;}
 chooseMode('plan');
}
function chooseMode(mode){
 mapMode=mode;
 const offline=mode==='plan';
 $('live-map-panel').hidden=offline;
 $('offline-map-panel').hidden=!offline;
 $('map-choice-live').classList.toggle('map-choice-active',!offline);
 $('map-choice-plan').classList.toggle('map-choice-active',offline);
 $('map-choice-live').setAttribute('aria-pressed',String(!offline));
 $('map-choice-plan').setAttribute('aria-pressed',String(offline));
 if(!offline){$('map-fallback-alert').hidden=true;activate(selectedTour,openCard);}
}
function setup(){
 $('map-choice-live').addEventListener('click',()=>chooseMode('live'));
 $('map-choice-plan').addEventListener('click',()=>chooseMode('plan'));
 $('map-home').addEventListener('click',fitStops);
 $('map-locate').addEventListener('click',locate);
 $('map-stop-gps').addEventListener('click',stopTracking);
}
function applyNavigationBounds(t){
 // Every tour has its own navigable geographic envelope. This also records
 // the future licensed offline-tile export area, with approach padding.
 if(!live||!t?.map?.navBounds)return;
 live.setMaxBounds(t.map.navBounds);
}
function pointInsideBounds(lon,lat,bounds){
 return bounds && lon>=bounds[0][0] && lon<=bounds[1][0] && lat>=bounds[0][1] && lat<=bounds[1][1];
}
function setTour(t,callback){
 const changed=selectedTour?.id!==t?.id;
 selectedTour=t;openCard=callback;
 if(changed && t?.map?.defaultView){
   const mode=t.map.defaultView;
   if(mapMode!==mode)chooseMode(mode);
 }
 if(live&&loaded){applyNavigationBounds(t);drawMarkers();if(changed)fitStops();}
}
async function activate(t,callback){
 if(!t||!t.map)return;
 selectedTour=t;openCard=callback;
 if(mapMode==='plan')return;
 if(live){requestAnimationFrame(()=>{live.resize();applyNavigationBounds(t);drawMarkers();fitStops();});return;}
 $('map-online-note').textContent='Загружаем интерактивную карту OpenFreeMap… Для офлайна можно переключиться на «Схему офлайн».';
 try{
  await loadLib();
  if(live)return;
  // MapLibre GL JS v5 exposes Map but not a public supported() function.
  // Calling supported() caused the false fallback even after the library loaded.
  if(typeof window.maplibregl?.Map !== 'function')throw new Error('Библиотека MapLibre не содержит Map');
  live=new window.maplibregl.Map({container:'osm-map',style:STYLE,center:t.map.center,zoom:t.map.zoom||16,minZoom:10,maxZoom:20,maxBounds:t.map.navBounds,attributionControl:false});
  live.addControl(new window.maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  live.addControl(new window.maplibregl.AttributionControl({compact:true}),'bottom-left');
  let statusDone=false;
  live.on('load',()=>{loaded=true;statusDone=true;applyNavigationBounds(selectedTour);drawMarkers();fitStops();$('map-online-note').textContent='OSM / OpenFreeMap: тёмные метки — памятники, пунктир — примерные зоны или общий ориентир здания. При совпадающих точках нажмите на группу номеров. Это НЕ GPS-навигация внутри объектов. Нужен интернет.';});
  live.on('error',e=>{console.warn('OSM map error',e.error);if(!statusDone){fallback('Не удалось загрузить картографические данные OpenFreeMap.');}});
 }catch(e){fallback('Не получилось загрузить карту: '+e.message);}
}
function drawMarkers(){
 if(!live||!loaded||!selectedTour?.map)return;
 markers.forEach(m=>m.remove());markers=[];
 if(venueMarker){venueMarker.remove();venueMarker=null;}
 const points=selectedTour.map.geoPoints||{};
 if(Object.keys(points).length < selectedTour.stops.length){
   const el=document.createElement('div');el.className='maplibre-area-marker';el.textContent='⌖';
   el.title='Часть рассказов доступна только на схеме (например, музейные экспонаты).';
   el.setAttribute('role','button');el.setAttribute('tabindex','0');
   el.addEventListener('click',()=>chooseMode('plan'));
   el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseMode('plan')}});
   venueMarker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(selectedTour.map.center).addTo(live);
 }
 // Stops at the exact same mapped site are intentionally grouped. Never
 // scatter synthetic points to make underground rooms look GPS-precise.
 const groups=new Map();
 selectedTour.stops.forEach((s,i)=>{
   const p=points[s.id];if(!p)return;
   const key=p.lat.toFixed(6)+','+p.lng.toFixed(6);
   if(!groups.has(key))groups.set(key,{p,stops:[]});
   groups.get(key).stops.push({s,i,p});
 });
 for(const g of groups.values()){
   const entries=g.stops, p=g.p, first=entries[0];
   const el=document.createElement('button');el.type='button';el.className='maplibre-marker';
   const approximate=entries.some(x=>['shared_site','approx_plan','interpretive_zone','legacy_approx','area','photo_viewpoint'].includes(x.p.precision));
   if(approximate)el.classList.add('maplibre-marker-approx');
   if(entries.length>1)el.classList.add('maplibre-marker-group');
   el.dataset.precision=p.precision||'legacy_approx';
   el.textContent=entries.length>1?entries.map(x=>x.i+1).join('·'):String(first.i+1);
   el.setAttribute('aria-label',entries.length>1?`Ориентир для ${entries.length} рассказов: ${entries.map(x=>x.i+1).join(', ')}`:`Ориентир ${first.i+1}: ${first.s.title}`);
   el.title=entries.map(x=>`${x.i+1}. ${x.s.title}\n${x.p.note||'Ориентир памятника'}\nИсточник: ${x.p.source||'не указан'}`).join('\n\n');
   el.addEventListener('click',e=>{
     e.preventDefault();e.stopPropagation();
     if(entries.length===1){if(openCard)openCard(first.s.id);return;}
     // The popup makes every stop reachable without overlapping identical pins.
     const wrap=document.createElement('div');wrap.className='map-stop-popup';
     const heading=document.createElement('strong');heading.textContent='Один ориентир — несколько рассказов';wrap.appendChild(heading);
     const warning=document.createElement('small');warning.textContent='Положение здания/комплекса, не отдельных комнат и витрин';wrap.appendChild(warning);
     entries.forEach(x=>{
       const b=document.createElement('button');b.type='button';b.textContent=`${x.i+1}. ${x.s.title}`;
       b.addEventListener('click',()=>{popup.remove();if(openCard)openCard(x.s.id)});
       wrap.appendChild(b);
     });
     const popup=new maplibregl.Popup({maxWidth:'300px',closeButton:true,offset:22}).setLngLat([p.lng,p.lat]).setDOMContent(wrap).addTo(live);
   });
   markers.push(new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([p.lng,p.lat]).addTo(live));
 }
}
function fitStops(){
 if(!live||!loaded||!selectedTour?.map)return;
 const ps=(selectedTour.stops||[]).map(s=>selectedTour.map.geoPoints?.[s.id]).filter(Boolean);
 if(!ps.length){live.flyTo({center:selectedTour.map.center,zoom:Math.min(selectedTour.map.zoom||16,16),duration:350});return;}
 const minLng=Math.min(...ps.map(p=>p.lng)),minLat=Math.min(...ps.map(p=>p.lat));
 const maxLng=Math.max(...ps.map(p=>p.lng)),maxLat=Math.max(...ps.map(p=>p.lat));
 live.fitBounds([[minLng,minLat],[maxLng,maxLat]],{padding:38,maxZoom:selectedTour.map.zoom||17.5,duration:500});
}
function stopTracking(){
 if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}
 if(geoMarker){geoMarker.remove();geoMarker=null;}
 if(live&&live.getLayer('gps-accuracy-fill')){live.removeLayer('gps-accuracy-fill');live.removeLayer('gps-accuracy-outline');live.removeSource('gps-accuracy');}
 $('map-stop-gps').hidden=true;setStatus('Геопозиция выключена');
}
function locate(){
 if(!navigator.geolocation){setStatus('GPS недоступен');return;}
 if(!window.isSecureContext){setStatus('GPS: откройте PWA через HTTPS или localhost');return;}
 if(watchId!==null){if(geoMarker&&live){const p=geoMarker.getLngLat();if(pointInsideBounds(p.lng,p.lat,selectedTour?.map?.navBounds))live.flyTo({center:p,zoom:17});else setStatus('Вы пока вне области карты этой экскурсии');}return;}
 setStatus('Ищем ваше местоположение…');
 watchId=navigator.geolocation.watchPosition(pos=>{
   const {latitude,longitude,accuracy:meters}=pos.coords;
   if(!live||!loaded){setStatus('Карта ещё загружается');return;}
   $('map-stop-gps').hidden=false;
   if(!geoMarker){
     const el=document.createElement('div');el.className='maplibre-user-dot';
     geoMarker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([longitude,latitude]).addTo(live);
     if(pointInsideBounds(longitude,latitude,selectedTour?.map?.navBounds))live.flyTo({center:[longitude,latitude],zoom:Math.max(14,live.getZoom())});
   }else geoMarker.setLngLat([longitude,latitude]);
   if(accuracy){
     // Circle is a display of device-provided accuracy, not a position guarantee.
     const circle=makeCircle([longitude,latitude],meters);
     if(!live.getSource('gps-accuracy')){
       live.addSource('gps-accuracy',{type:'geojson',data:circle});
       live.addLayer({id:'gps-accuracy-fill',type:'fill',source:'gps-accuracy',paint:{'fill-color':'#347fce','fill-opacity':0.10}});
       live.addLayer({id:'gps-accuracy-outline',type:'line',source:'gps-accuracy',paint:{'line-color':'#347fce','line-width':1,'line-opacity':0.55}});
     }else live.getSource('gps-accuracy').setData(circle);
   }
   setStatus(pointInsideBounds(longitude,latitude,selectedTour?.map?.navBounds)?`GPS: погрешность ≈ ${Math.round(meters)} м`:'Вы вне области этой экскурсии; карта ограничена ближайшими подходами');
 },err=>{setStatus(err.code===1?'Доступ к GPS запрещён':'GPS: не удалось определить положение');
    if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;} $('map-stop-gps').hidden=true;
 },{enableHighAccuracy:true,maximumAge:15000,timeout:15000});
}
function makeCircle(center,r){
 const [lon,lat]=center,arr=[];
 for(let i=0;i<=60;i++){
  const a=i/60*2*Math.PI;
  const dLat=r/111320*Math.cos(a),dLon=r/(111320*Math.max(0.1,Math.cos(lat*Math.PI/180)))*Math.sin(a);
  arr.push([lon+dLon,lat+dLat]);
 }
 return {type:'Feature',geometry:{type:'Polygon',coordinates:[arr]},properties:{}};
}
window.EgyptAtlasMap={setup,setTour,activate};
})();
