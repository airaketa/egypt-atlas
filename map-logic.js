/* Egypt Atlas v0.26: local PMTiles basemap with an online fallback. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const RUNTIME={maplibre:'./vendor/maplibre-gl.js',css:'./vendor/maplibre-gl.css',pmtiles:'./vendor/pmtiles.js'};
const ONLINE_STYLE='https://tiles.openfreemap.org/styles/liberty';
let live = null, markers = [], venueMarker = null, geoMarker = null, accuracy = null, watchId = null;
let selectedTour = null, openCard = null, loadPromise = null, manifestPromise = null, loaded = false, mapMode = 'live', liveTourId = null;
const setStatus = s => { if ($('map-gps-status')) $('map-gps-status').textContent=s; };
function loadScript(src,ready){
 if(ready())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=src;script.async=true;
  const timer=setTimeout(()=>{script.remove();reject(new Error('Превышено время загрузки '+src));},12000);
  script.onload=()=>{clearTimeout(timer);ready()?resolve():reject(new Error('Модуль не экспортирован: '+src));};
  script.onerror=()=>{clearTimeout(timer);reject(new Error('Не найден локальный модуль: '+src));};
  document.head.appendChild(script);
 });
}
function loadLib() {
 if(window.maplibregl&&window.pmtiles)return Promise.resolve();
 if(loadPromise)return loadPromise;
 loadPromise=(async()=>{
  const css=document.getElementById('maplibre-css')||document.createElement('link');
  css.id='maplibre-css';css.rel='stylesheet';css.href=RUNTIME.css;
  if(!css.isConnected)document.head.appendChild(css);
  await loadScript(RUNTIME.maplibre,()=>!!window.maplibregl);
  await loadScript(RUNTIME.pmtiles,()=>!!window.pmtiles);
  if(!window.__egyptAtlasPmtilesProtocol){
   const protocol=new window.pmtiles.Protocol();
   window.maplibregl.addProtocol('pmtiles',protocol.tile);
   window.__egyptAtlasPmtilesProtocol=protocol;
  }
 })().catch(e=>{loadPromise=null;throw e});
 return loadPromise;
}
async function offlineMapPath(tourId){
 if(!manifestPromise)manifestPromise=fetch('./offline-manifest.json').then(r=>r.ok?r.json():null).catch(()=>null);
 const manifest=await manifestPromise;
 const item=manifest?.maps?.find(map=>map.id===tourId);
 if(item?.path)return item.path;
 if(location.protocol==='file:')return null;
 const candidate=`./maps/offline/${encodeURIComponent(tourId)}.pmtiles`;
 try{
  const response=await fetch(candidate,{headers:{Range:'bytes=0-6'}});
  if(!response.ok)return null;
  const magic=new Uint8Array(await response.arrayBuffer()).slice(0,7);
  return new TextDecoder().decode(magic)==='PMTiles'?candidate:null;
 }catch(_){return null;}
}
function localStyle(path){
 const archive=new URL(path,location.href).href;
 const source='protomaps';
 return {version:8,name:'Egypt Atlas Offline',sources:{[source]:{type:'vector',url:'pmtiles://'+archive}},layers:[
  {id:'background',type:'background',paint:{'background-color':'#f2ead9'}},
  {id:'earth',type:'fill',source,'source-layer':'earth',paint:{'fill-color':'#eee5d2'}},
  {id:'landuse',type:'fill',source,'source-layer':'landuse',paint:{'fill-color':'#dfe6cf','fill-opacity':0.62}},
  {id:'water',type:'fill',source,'source-layer':'water',paint:{'fill-color':'#a9d5df'}},
  {id:'buildings',type:'fill',source,'source-layer':'buildings',minzoom:12,paint:{'fill-color':'#d3c3aa','fill-outline-color':'#b8a78e','fill-opacity':0.82}},
  {id:'road-casing',type:'line',source,'source-layer':'roads',paint:{'line-color':'#b8a990','line-width':['interpolate',['linear'],['zoom'],10,1,15,5,19,12]}},
  {id:'roads',type:'line',source,'source-layer':'roads',paint:{'line-color':'#fffaf0','line-width':['interpolate',['linear'],['zoom'],10,.6,15,3.2,19,9]}},
  {id:'boundaries',type:'line',source,'source-layer':'boundaries',paint:{'line-color':'#a89070','line-width':1,'line-dasharray':[3,3]}},
  {id:'pois',type:'circle',source,'source-layer':'pois',minzoom:14,paint:{'circle-radius':2.5,'circle-color':'#8c4f35','circle-stroke-color':'#fff','circle-stroke-width':1}}
 ],metadata:{'egypt-atlas:offline':true}};
}
function destroyLive(){
 stopTracking();markers.forEach(marker=>marker.remove());markers=[];venueMarker=null;
 if(live){live.remove();live=null;}loaded=false;liveTourId=null;
}
function fallback(message){
 console.warn('Egypt Atlas map fallback:',message);
 const alert=$('map-fallback-alert');if(alert){alert.textContent=message+' Показана офлайн-схема. Нажмите «Интерактивная карта», чтобы повторить.';alert.hidden=false;}
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
 if(changed&&live)destroyLive();
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
 $('map-online-note').textContent='Загружаем локальную интерактивную карту…';
 try{
  await loadLib();
  if(live)return;
  // MapLibre GL JS v5 exposes Map but not a public supported() function.
  // Calling supported() caused the false fallback even after the library loaded.
  if(typeof window.maplibregl?.Map !== 'function')throw new Error('Библиотека MapLibre не содержит Map');
  const mapPath=await offlineMapPath(t.id);
  const usingOffline=!!mapPath;
  liveTourId=t.id;
  live=new window.maplibregl.Map({container:'osm-map',style:usingOffline?localStyle(mapPath):ONLINE_STYLE,center:t.map.center,zoom:t.map.zoom||16,minZoom:10,maxZoom:20,maxBounds:t.map.navBounds,attributionControl:false});
  live.addControl(new window.maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  live.addControl(new window.maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap contributors · Protomaps'}),'bottom-left');
  let statusDone=false;
  live.on('load',()=>{loaded=true;statusDone=true;applyNavigationBounds(selectedTour);drawMarkers();fitStops();$('map-online-note').textContent=(usingOffline?'Локальная карта PMTiles доступна без интернета после загрузки офлайн-пакета. ':'Используется резервная онлайн-карта. ')+'Тёмные метки — памятники, пунктир — примерные зоны. Это НЕ GPS-навигация внутри объектов.';});
  live.on('error',e=>{console.warn('Map error',e.error);if(!statusDone){fallback(usingOffline?'Не удалось открыть локальную карту PMTiles.':'Не удалось загрузить резервную онлайн-карту.');}});
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
