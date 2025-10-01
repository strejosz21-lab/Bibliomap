// main.js - mapa interactivo mejorado
// Requiere: /mapping.json (ya expuesto por backend) y Fuse.js (CDN incluido en HTML)

(async function(){
  // utilidades
  const q = sel => document.querySelector(sel);
  const create = (tag, ns=true) => ns ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);

  const colorByClass = {
    "0": "#6366f1", // referencias generales
    "1": "#7c3aed",
    "2": "#0ea5a4",
    "3": "#06b6d4",
    "4": "#f97316",
    "5": "#ef4444",
    "6": "#f59e0b",
    "7": "#10b981",
    "8": "#6366f1",
    "9": "#a78bfa",
    "default": "#94a3b8"
  };

  // leer mapping desde backend
  async function fetchMapping(){
    const res = await fetch("/mapping.json");
    return await res.json();
  }

  const mapping = await fetchMapping();
  if (mapping.error) {
    q('#infoBox').textContent = "Error cargando mapping: " + (mapping.error || mapping.details);
    return;
  }

  const rows = mapping.rows || [];
  const filas = mapping.max_estante || 10;
  const columnas = mapping.total_anaqueles || 5;

  // preparar datos para Fuse (búsqueda)
  const fuseList = rows.map(r => ({
    key: `F${r.estante}-A${r.anaquel}`,
    estante: r.estante,
    anaquel: r.anaquel,
    raw: r.raw || "",
    start: r.start,
    end: r.end
  }));
  const fuse = new Fuse(fuseList, {
    keys: ['raw', 'key'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2
  });

  // SVG y layout
  const svg = q('#mapSvg');
  const padding = 48;
  const ancho = 140, alto = 70, gap = 18;
  const svgW = Math.max(1000, padding*2 + columnas * (ancho + gap));
  const svgH = padding*2 + filas * (alto + gap);
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);

  // lookup map
  const lookup = {};
  fuseList.forEach(r => lookup[r.key] = r);

  // Tooltip element
  let tooltip = document.getElementById("__map_tooltip");
  if (!tooltip) {
    tooltip = create('div', false);
    tooltip.id = "__map_tooltip";
    tooltip.className = "tooltip";
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
  }

  // draw grid (rows x columns)
  for (let f=1; f<=filas; f++){
    for (let c=1; c<=columnas; c++){
      const x = padding + (c-1)*(ancho + gap);
      const y = padding + (f-1)*(alto + gap);
      const id = `F${f}-A${c}`;

      // rect
      const rect = create('rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', ancho);
      rect.setAttribute('height', alto);
      rect.setAttribute('rx', 10);
      rect.setAttribute('class', 'rect-anaquel');
      rect.setAttribute('id', id);
      svg.appendChild(rect);

      // label
      const text = create('text');
      text.setAttribute('x', x + ancho/2);
      text.setAttribute('y', y + alto/2 + 6);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'label');
      text.textContent = id;
      svg.appendChild(text);

      // events
      rect.addEventListener('mouseenter', (ev) => {
        const key = id;
        const data = lookup[key];
        const raw = (data && data.raw) ? data.raw : "Sin datos";
        tooltip.style.display = 'block';
        tooltip.innerHTML = `<strong>${key}</strong><div style="margin-top:6px; color:#475569;">${raw}</div>
                             <div style="margin-top:8px"><button data-key="${key}" class="openSide">Ver detalles</button></div>`;
        const bbox = ev.target.getBoundingClientRect();
        tooltip.style.left = `${bbox.right + 10}px`;
        tooltip.style.top = `${Math.max(8,bbox.top)}px`;
      });
      rect.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
      rect.addEventListener('click', () => {
        const key = id;
        const data = lookup[key];
        if (data) {
          focusOnElement(id);
          showSide(data);
        }
      });
    }
  }

  // Build legend
  const legendEl = document.getElementById('legend');
  const seen = new Set();
  rows.forEach(r => {
    // tomar primera cifra significativa del start si existe, sino default
    let cls = 'default';
    if (r.start != null) {
      const first = String(Math.floor(r.start)).charAt(0);
      cls = first || 'default';
    }
    if (seen.has(cls)) return;
    seen.add(cls);
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    const sw = document.createElement('span');
    sw.style.width = '18px';
    sw.style.height = '18px';
    sw.style.borderRadius = '6px';
    sw.style.display = 'inline-block';
    sw.style.background = colorByClass[cls] || colorByClass.default;
    div.appendChild(sw);
    const label = document.createElement('span');
    label.textContent = (cls === 'default') ? 'Otras' : `Sección ${cls}xx`;
    label.className = 'text-sm text-slate-700';
    div.appendChild(label);
    legendEl.appendChild(div);
  });

  // Utility: pan/zoom (manipular viewBox)
  let viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
  let current = {x:viewBox[0], y:viewBox[1], w:viewBox[2], h:viewBox[3]};
  function setViewBox(x,y,w,h){
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    current = {x,y,w,h};
  }
  // center on element
  function focusOnElement(id){
    const el = document.getElementById(id);
    if (!el) return;
    const bbox = el.getBBox();
    // center with padding & smooth transition (animate with requestAnimationFrame)
    const targetW = Math.min(current.w, bbox.width*4);
    const targetH = Math.min(current.h, bbox.height*4);
    const tx = Math.max(0, bbox.x + bbox.width/2 - targetW/2);
    const ty = Math.max(0, bbox.y + bbox.height/2 - targetH/2);
    animateView(current.x, current.y, current.w, current.h, tx, ty, targetW, targetH, 400);
    // add highlight class
    clearHighlights();
    el.classList.add('highlight');
  }

  // animate viewBox
  function animateView(sx,sy,sw,sh, tx,ty,tw,th, duration){
    const start = performance.now();
    function step(now){
      const t = Math.min(1, (now - start)/duration);
      const ease = t<.5 ? 2*t*t : -1 + (4-2*t)*t;
      const x = sx + (tx - sx) * ease;
      const y = sy + (ty - sy) * ease;
      const w = sw + (tw - sw) * ease;
      const h = sh + (th - sh) * ease;
      setViewBox(x,y,w,h);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function clearHighlights(){
    document.querySelectorAll('.rect-anaquel').forEach(r => r.classList.remove('highlight'));
  }

  // Fit all
  function fitAll(){
    // volver al viewBox inicial completo
    const vb = `0 0 ${svgW} ${svgH}`;
    animateView(current.x, current.y, current.w, current.h, 0, 0, svgW, svgH, 400);
    clearHighlights();
  }

  // show side info
  const side = q('#sideInfo');
  function showSide(data){
    q('#sideContent').innerHTML = `<h3 class="font-semibold">F${data.estante} - A${data.anaquel}</h3>
      <div style="margin-top:6px;color:#475569">${data.raw || 'Sin datos'}</div>
      <div style="margin-top:10px" class="text-xs text-slate-500">Rango: ${data.start || '-'} — ${data.end || '-'}</div>`;
    side.classList.remove('hidden');
  }
  q('#closeSide').addEventListener('click', ()=> side.classList.add('hidden'));

  // search function: intenta parse numérico primero, si no usa fuzzy
  function searchTerm(term){
    clearHighlights();
    if (!term) {
      q('#infoBox').textContent = "Ingresa un código Dewey para buscar.";
      return;
    }
    // extraer primer número
    const m = term.match(/\d+(?:\.\d+)?/);
    if (m){
      const code = parseFloat(m[0]);
      // buscar por rango exacto
      const found = fuseList.find(r => r.start != null && r.end != null && r.start <= code && code <= r.end);
      if (found){
        q('#infoBox').innerHTML = `✅ Encontrado: <strong>F${found.estante}-A${found.anaquel}</strong>`;
        focusOnElement(`F${found.estante}-A${found.anaquel}`);
        addMatchToList(found);
        return;
      }
    }

    // fuzzy fallback
    const res = fuse.search(term);
    if (res && res.length){
      q('#infoBox').textContent = `🔎 ${res.length} coincidencia(s). Selecciona una:`;
      q('#matchesList').innerHTML = '';
      res.slice(0,8).forEach(r => {
        addMatchToList(r.item);
      });
    } else {
      q('#infoBox').textContent = "❌ No se encontró coincidencia.";
      q('#matchesList').innerHTML = '';
    }
  }

  // add item to matches list (clickable)
  function addMatchToList(item){
    const li = document.createElement('li');
    li.className = 'p-2 rounded hover:bg-slate-50 flex justify-between items-center';
    li.innerHTML = `<div>
        <div class="font-medium">F${item.estante} - A${item.anaquel}</div>
        <div class="text-xs text-slate-500">${item.raw || ''}</div>
      </div>
      <div class="flex flex-col gap-1">
        <button class="btnGo text-xs" data-key="F${item.estante}-A${item.anaquel}">Ir</button>
      </div>`;
    q('#matchesList').appendChild(li);

    li.querySelector('.btnGo').addEventListener('click', (e) => {
      const key = e.target.dataset.key;
      focusOnElement(key);
      showSide(lookup[key]);
    });
  }

  // wire UI
  q('#btnSearch').addEventListener('click', ()=> searchTerm(q('#searchInput').value.trim()));
  q('#btnClear').addEventListener('click', ()=> { q('#searchInput').value=''; fitAll(); q('#matchesList').innerHTML=''; q('#infoBox').textContent='Ingresa un código Dewey para buscar.'; });
  q('#searchInput').addEventListener('keydown', (e) => { if (e.key==='Enter') searchTerm(e.target.value.trim()); });

  // zoom buttons
  q('#zoomIn').addEventListener('click', ()=> {
    animateView(current.x, current.y, current.w, current.h, current.x + current.w*0.1, current.y + current.h*0.1, current.w*0.8, current.h*0.8, 300);
  });
  q('#zoomOut').addEventListener('click', ()=> {
    animateView(current.x, current.y, current.w, current.h, Math.max(0,current.x - current.w*0.1), Math.max(0,current.y - current.h*0.1), current.w*1.2, current.h*1.2, 300);
  });
  q('#fitAll').addEventListener('click', ()=> fitAll());

  // click open tooltip button "Ver detalles"
  document.body.addEventListener('click', (e)=> {
    if (e.target && e.target.matches('button.openSide')) {
      const k = e.target.dataset.key;
      if (k && lookup[k]) {
        showSide(lookup[k]);
      }
    }
  });

  // initial fit
  fitAll();

})();
