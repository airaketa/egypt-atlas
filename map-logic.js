/* Generic Atlas map renderer: local PMTiles first, online fallback second. */
(() => {
'use strict';

const RUNTIME={maplibre:'./vendor/maplibre-gl.js',css:'./vendor/maplibre-gl.css',pmtiles:'./vendor/pmtiles.js'};
const ONLINE_STYLE='https://tiles.openfreemap.org/styles/liberty';
let map=null,markers=[],geoMarker=null,watchId=null,loadPromise=null,currentContainer=null;

function loadScript(src,ready){
 if(ready())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=src;script.async=true;
  const timer=setTimeout(()=>{script.remove();reject(new Error('Превышено время загрузки '+src));},15000);
  script.onload=()=>{clearTimeout(timer);ready()?resolve():reject(new Error('Модуль не экспортирован: '+src));};
  script.onerror=()=>{clearTimeout(timer);reject(new Error('Не найден модуль: '+src));};
  document.head.appendChild(script);
 });
}
function loadRuntime(){
 if(window.maplibregl&&window.pmtiles)return Promise.resolve();
 if(loadPromise)return loadPromise;
 loadPromise=(async()=>{
  let css=document.getElementById('maplibre-css');
  if(!css){css=document.createElement('link');css.id='maplibre-css';css.rel='stylesheet';css.href=RUNTIME.css;document.head.appendChild(css);}
  await loadScript(RUNTIME.maplibre,()=>!!window.maplibregl);
  await loadScript(RUNTIME.pmtiles,()=>!!window.pmtiles);
  if(!window.__atlasPmtilesProtocol){const protocol=new window.pmtiles.Protocol();window.maplibregl.addProtocol('pmtiles',protocol.tile);window.__atlasPmtilesProtocol=protocol;}
 })().catch(error=>{loadPromise=null;throw error;});
 return loadPromise;
}
function localLayers(source,suffix){
 return [
  {id:`earth-${suffix}`,type:'fill',source,'source-layer':'earth',paint:{'fill-color':'#eee5d2'}},
  {id:`landuse-${suffix}`,type:'fill',source,'source-layer':'landuse',paint:{'fill-color':'#dfe6cf','fill-opacity':.62}},
  {id:`water-${suffix}`,type:'fill',source,'source-layer':'water',paint:{'fill-color':'#a9d5df'}},
  {id:`buildings-${suffix}`,type:'fill',source,'source-layer':'buildings',minzoom:12,paint:{'fill-color':'#d3c3aa','fill-outline-color':'#b8a78e','fill-opacity':.82}},
  {id:`road-casing-${suffix}`,type:'line',source,'source-layer':'roads',paint:{'line-color':'#b8a990','line-width':['interpolate',['linear'],['zoom'],10,1,15,5,19,12]}},
  {id:`roads-${suffix}`,type:'line',source,'source-layer':'roads',paint:{'line-color':'#fffaf0','line-width':['interpolate',['linear'],['zoom'],10,.6,15,3.2,19,9]}},
  {id:`boundaries-${suffix}`,type:'line',source,'source-layer':'boundaries',paint:{'line-color':'#a89070','line-width':1,'line-dasharray':[3,3]}},
  {id:`pois-${suffix}`,type:'circle',source,'source-layer':'pois',minzoom:14,paint:{'circle-radius':2.5,'circle-color':'#8c4f35','circle-stroke-color':'#fff','circle-stroke-width':1}}
 ];
}
function localStyle(paths){
 const sources={},layers=[{id:'background',type:'background',paint:{'background-color':'#f2ead9'}}];
 paths.forEach((path,index)=>{
  const source=`atlas-basemap-${index}`;
  sources[source]={type:'vector',url:'pmtiles://'+new URL(path,location.href).href};
  layers.push(...localLayers(source,String(index)));
 });
 return {version:8,name:'Atlas Offline',sources,layers};
}
async function archiveAvailable(path){
 if(!path)return false;
 try{const response=await fetch(new URL(path,location.href),{headers:{Range:'bytes=0-6'}});if(!response.ok)return false;const bytes=new Uint8Array(await response.arrayBuffer());return new TextDecoder().decode(bytes.slice(0,7))==='PMTiles';}catch(_){return false;}
}
function stopLocation(){
 if(watchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(watchId);watchId=null;}
 if(geoMarker){geoMarker.remove();geoMarker=null;}
}
function unmount(){
 stopLocation();markers.forEach(marker=>marker.remove());markers=[];
 if(map){map.remove();map=null;}currentContainer=null;
}
function markerGroups(attraction){
 const groups=new Map(),points=attraction.map?.geoPoints||{};
 attraction.points.forEach((point,index)=>{
  const location=points[point.id]||point.location;if(!location||!Number.isFinite(location.lat)||!Number.isFinite(location.lng))return;
  const key=`${location.lat.toFixed(6)},${location.lng.toFixed(6)}`;
  if(!groups.has(key))groups.set(key,{location,items:[]});groups.get(key).items.push({point,index});
 });
 return [...groups.values()];
}
function mappedPointCount(attraction){
 return markerGroups(attraction).reduce((sum,group)=>sum+group.items.length,0);
}
function drawMarkers(attraction,openPoint){
 markerGroups(attraction).forEach(group=>{
  const element=document.createElement('button');element.type='button';element.className='map-marker';
  const approximate=['shared_site','approx_plan','interpretive_zone','legacy_approx','area','photo_viewpoint'].includes(group.location.precision);
  if(approximate)element.classList.add('approximate');
  element.textContent=group.items.map(item=>item.index+1).join('·');
  element.setAttribute('aria-label',group.items.map(item=>`${item.index+1}. ${item.point.title}`).join(', '));
  element.addEventListener('click',()=>{
   if(group.items.length===1){openPoint(group.items[0].point.id);return;}
   const wrap=document.createElement('div');wrap.className='map-popup';
   const title=document.createElement('strong');title.textContent='Рассказы у одного ориентира';wrap.appendChild(title);
   group.items.forEach(item=>{const button=document.createElement('button');button.type='button';button.textContent=`${item.index+1}. ${item.point.title}`;button.addEventListener('click',()=>{popup.remove();openPoint(item.point.id);});wrap.appendChild(button);});
   const popup=new maplibregl.Popup({maxWidth:'300px',offset:22}).setLngLat([group.location.lng,group.location.lat]).setDOMContent(wrap).addTo(map);
  });
  markers.push(new maplibregl.Marker({element,anchor:'center'}).setLngLat([group.location.lng,group.location.lat]).addTo(map));
 });
}
function cityLocations(city){
 return city.attractions.map((attraction,index)=>({attraction,index,location:attraction.map?.center})).filter(item=>Array.isArray(item.location)&&Number.isFinite(item.location[0])&&Number.isFinite(item.location[1]));
}
function drawCityMarkers(city,openAttraction){
 cityLocations(city).forEach(({attraction,index,location})=>{
  const element=document.createElement('button');element.type='button';element.className='map-marker city-map-marker';
  element.textContent=String(index+1);element.setAttribute('aria-label',`${index+1}. ${attraction.title}`);
  element.addEventListener('click',()=>openAttraction(attraction.id));
  markers.push(new maplibregl.Marker({element,anchor:'center'}).setLngLat(location).addTo(map));
 });
}
function fitAttraction(attraction){
 if(!map)return;const groups=markerGroups(attraction);
 if(!groups.length){map.flyTo({center:attraction.map.center,zoom:attraction.map.zoom||15});return;}
 const bounds=new maplibregl.LngLatBounds();groups.forEach(group=>bounds.extend([group.location.lng,group.location.lat]));
 map.fitBounds(bounds,{padding:44,maxZoom:attraction.map.zoom||17,duration:500});
}
function fitCity(city){
 if(!map)return;const locations=cityLocations(city);
 if(!locations.length)return;
 const bounds=new maplibregl.LngLatBounds();locations.forEach(item=>bounds.extend(item.location));
 if(locations.length===1)map.flyTo({center:locations[0].location,zoom:13});
 else map.fitBounds(bounds,{padding:58,maxZoom:13,duration:500});
}
function locate(status){
 if(!navigator.geolocation){status.textContent='GPS недоступен';return;}
 if(!window.isSecureContext){status.textContent='GPS работает только через HTTPS';return;}
 if(watchId!==null)return;
 status.textContent='Ищем местоположение…';
 watchId=navigator.geolocation.watchPosition(position=>{
  const {longitude,latitude,accuracy}=position.coords;
  if(!map)return;
  if(!geoMarker){const element=document.createElement('div');element.className='map-user-dot';geoMarker=new maplibregl.Marker({element}).setLngLat([longitude,latitude]).addTo(map);map.flyTo({center:[longitude,latitude],zoom:16});}
  else geoMarker.setLngLat([longitude,latitude]);
  status.textContent=`GPS · точность около ${Math.round(accuracy)} м`;
 },error=>{status.textContent='Не удалось определить геопозицию';console.warn(error);},{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
}
async function showLive(container,attraction,openPoint,note){
 const canvas=container.querySelector('.map-canvas');canvas.hidden=false;const plan=container.querySelector('.map-plan');if(plan)plan.hidden=true;
 try{
  await loadRuntime();if(currentContainer!==container)return;
  const local=await archiveAvailable(attraction.map.archive);if(currentContainer!==container)return;
  map=new maplibregl.Map({container:canvas,style:local?localStyle([attraction.map.archive]):ONLINE_STYLE,center:attraction.map.center,zoom:attraction.map.zoom||15,minZoom:9,maxZoom:20,maxBounds:attraction.map.navBounds,attributionControl:false});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap contributors · Protomaps'}),'bottom-left');
  map.on('load',()=>{drawMarkers(attraction,openPoint);fitAttraction(attraction);note.textContent=(local?'Локальная PMTiles-карта. После установки пакета работает без интернета.':'Резервная онлайн-карта; скачайте пакет города для офлайна.')+' Геометки ориентировочные.';});
  map.on('error',event=>console.warn('Atlas map',event.error));
 }catch(error){note.textContent='Интерактивная карта недоступна: '+error.message;if(container.querySelector('[data-map-mode="plan"]'))showPlan(container);}
}
function showPlan(container){
 if(map){map.remove();map=null;}markers=[];
 container.querySelector('.map-canvas').hidden=true;container.querySelector('.map-plan').hidden=false;
 container.querySelector('[data-map-mode="live"]')?.classList.remove('active');container.querySelector('[data-map-mode="plan"]')?.classList.add('active');
}
function mount(container,attraction,openPoint){
 unmount();if(!container||!attraction?.map)return;currentContainer=container;
 const image=attraction.map.image||'',allowPlan=!!image&&mappedPointCount(attraction)<attraction.points.length;
 container.innerHTML=`<section class="map-shell"><div class="map-toolbar"><div class="map-tabs"><button type="button" class="active" data-map-mode="live">Карта</button>${allowPlan?'<button type="button" data-map-mode="plan">Схема</button>':''}</div><div><button type="button" class="map-tool" data-map-fit>Все точки</button><button type="button" class="map-tool" data-map-locate>Моё место</button></div></div><div class="map-canvas"></div>${allowPlan?`<div class="map-plan" hidden><img src="${image}" alt="Схема ${attraction.title}"></div>`:''}<p class="map-note">Загружаем карту…</p></section>`;
 const note=container.querySelector('.map-note'),liveButton=container.querySelector('[data-map-mode="live"]'),planButton=container.querySelector('[data-map-mode="plan"]');
 liveButton.addEventListener('click',()=>{liveButton.classList.add('active');planButton?.classList.remove('active');if(!map)showLive(container,attraction,openPoint,note);else{container.querySelector('.map-canvas').hidden=false;if(container.querySelector('.map-plan'))container.querySelector('.map-plan').hidden=true;map.resize();}});
 planButton?.addEventListener('click',()=>{showPlan(container);note.textContent=attraction.map.note||'Схема маршрута.';});
 container.querySelector('[data-map-fit]').addEventListener('click',()=>fitAttraction(attraction));
 container.querySelector('[data-map-locate]').addEventListener('click',()=>locate(note));
 if(allowPlan&&attraction.map.defaultView==='plan'){showPlan(container);note.textContent=attraction.map.note||'Схема маршрута.';}else showLive(container,attraction,openPoint,note);
}

async function showCity(container,city,openAttraction,note){
 const canvas=container.querySelector('.map-canvas');
 try{
  await loadRuntime();if(currentContainer!==container)return;
  const cityMap=city.city?.map||{},local=await archiveAvailable(cityMap.archive);if(currentContainer!==container)return;
  const first=cityMap.center||cityLocations(city)[0]?.location||[31.2357,30.0444];
  map=new maplibregl.Map({container:canvas,style:local?localStyle([cityMap.archive]):ONLINE_STYLE,center:first,zoom:cityMap.zoom||11,minZoom:7,maxZoom:20,maxBounds:cityMap.navBounds,attributionControl:false});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap contributors · Protomaps'}),'bottom-left');
  map.on('load',()=>{drawCityMarkers(city,openAttraction);fitCity(city);note.textContent=local?'Обзорная PMTiles-карта работает офлайн после установки пакета города.':'Резервная онлайн-карта; скачайте пакет города для офлайна.';});
  map.on('error',event=>console.warn('Atlas city map',event.error));
 }catch(error){note.textContent='Обзорная карта недоступна: '+error.message;}
}
function mountCity(container,city,openAttraction){
 unmount();if(!container||!city?.attractions?.length)return;currentContainer=container;
 container.innerHTML=`<section class="map-shell city-map-shell"><div class="map-toolbar"><strong>Карта города</strong><div><button type="button" class="map-tool" data-map-fit>Все места</button><button type="button" class="map-tool" data-map-locate>Моё место</button></div></div><div class="map-canvas"></div><p class="map-note">Загружаем обзорную карту…</p></section>`;
 const note=container.querySelector('.map-note');
 container.querySelector('[data-map-fit]').addEventListener('click',()=>fitCity(city));
 container.querySelector('[data-map-locate]').addEventListener('click',()=>locate(note));
 showCity(container,city,openAttraction,note);
}

window.AtlasMap={mount,mountCity,unmount};
})();
