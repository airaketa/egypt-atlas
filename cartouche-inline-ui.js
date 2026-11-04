/* Egypt Atlas 0.20: captions are visible inside the existing stop;
   narration is part of the stop script and its single MP3. */
'use strict';
(function(){
 const d=window.EgyptAtlasCartouchesInline;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const box=document.getElementById('inline-cartouches');
 if(!box||!d)return;
 function photoSrc(key){return `./assets/cartouches/${key}.jpg`}
 window.EgyptAtlasCartouchesInlineUI={
  setStop(stop){
   const blocks=d.blocks[stop.id];
   box.hidden=!blocks?.length;
   if(!blocks?.length){box.innerHTML='';return}
   box.innerHTML=`<div class="ici-intro"><span>✦ КАРТУШИ · ВНУТРИ АУДИО</span><h3>Увидеть царские имена</h3><p>Светлана рассказывает об этом прямо в основной записи. Здесь — реальные фотографии и короткие подсказки к знакам. Листать отдельный урок не нужно.</p></div>`+
    blocks.map(b=>{
      const ph=d.photos[b.photo];
      return `<article class="ici-panel"><div class="ici-panel-head"><strong>${esc(b.title)}</strong><small>${esc(b.subtitle)}</small></div>`+
      `<figure class="ici-photo"><img loading="lazy" data-photo="${esc(b.photo)}" src="${photoSrc(b.photo)}" alt="${esc(ph.note)}"><figcaption>${esc(ph.location)} · ${esc(ph.note)}</figcaption></figure>`+
      `<div class="ici-lesson"><b>Разбираем имя: ${esc(b.reading)}</b><div class="ici-glyphs">`+
      b.pieces.map(g=>`<div class="ici-glyph"><img src="${esc(g.image)}" alt="Египетский иероглиф"><span><strong>${esc(g.sound)}</strong><small>${esc(g.comment)}</small></span></div>`).join('')+
      `</div><p class="ici-foot">${esc(b.footnote)}</p></div>`+
      `<p class="ici-credit">Фото: ${esc(ph.author)} · ${esc(ph.license)} · <a target="_blank" rel="noopener noreferrer" href="${esc(ph.source)}">Оригинал и лицензия ↗</a></p></article>`
    }).join('');
   box.querySelectorAll('img[data-photo]').forEach(img=>{
    const p=d.photos[img.dataset.photo];
    // If photos were pre-downloaded, local URLs work fully offline;
    // otherwise use the *actual* Commons photograph, never an invented illustration.
    img.addEventListener('error',function onerr(){
      img.removeEventListener('error',onerr);
      img.src=p.thumb;
      img.addEventListener('error',()=>{img.alt='Фотография недоступна офлайн. Источник — по ссылке ниже.';img.style.display='none';},{once:true});
    },{once:true});
   });
  }
 }
})();
