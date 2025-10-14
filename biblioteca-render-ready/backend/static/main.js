// main.js — mapa interactivo (versión corregida y mejorada)
// Requiere: /mapping.json (backend) y Fuse.js (CDN en el HTML)

(async function () {
  // ---------- helpers ----------
  const q = (s) => document.querySelector(s);
  const create = (tag, ns = true) =>
    ns ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);

  const colorByClass = {
    "0": "#6366f1", "1": "#7c3aed", "2": "#0ea5a4", "3": "#06b6d4",
    "4": "#f97316", "5": "#ef4444", "6": "#f59e0b", "7": "#10b981",
    "8": "#6366f1", "9": "#a78bfa", "default": "#94a3b8"
  };

  const svg = q("#mapSvg");
  const container = q("#svgContainer");

  // ---------- fetch mapping & areas ----------
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  let mapping = {};
  try {
    mapping = await fetchJSON("/mapping.json");
  } catch (e) {
    q("#infoBox").textContent = "Error cargando mapping.json";
    return;
  }
  if (mapping.error) {
    q("#infoBox").textContent =
      "Error cargando mapping: " + (mapping.error || mapping.details || "");
    return;
  }

  let areasResp = { ok: false, areas: [] };
  try {
    areasResp = await fetchJSON("/api/map-areas");
  } catch (_) { /* opcional */ }

  // ---------- preparar datos ----------
  const rows = mapping.rows || [];

  // ¡Nombres correctos del backend!
  const filas =
    mapping.max_estanteria ||
    Math.max(10, ...rows.map((r) => r.estanteria || 0));
  const columnas =
    mapping.max_anaquel ||
    Math.max(5, ...rows.map((r) => r.anaquel || 0));

  // lista para Fuse y lookup por clave F{estanteria}-A{anaquel}
  const fuseList = rows.map((r) => ({
    key: `F${r.estanteria}-A${r.anaquel}`,
    estanteria: r.estanteria,
    anaquel: r.anaquel,
    raw: r.raw || "",
    start: r.start,
    end: r.end
  }));
  const fuse = new Fuse(fuseList, {
    keys: ["raw", "key"],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2
  });
  const lookup = {};
  fuseList.forEach((r) => (lookup[r.key] = r));

  // ---------- SVG layout ----------
  const padding = 48;
  const ancho = 140, alto = 70, gap = 18;

  // si hay áreas reales, usamos lienzo normalizado 1000x1000
  const usingAreas = Array.isArray(areasResp.areas) && areasResp.areas.length > 0;
  const W = usingAreas ? 1000 : Math.max(1000, padding * 2 + columnas * (ancho + gap));
  const H = usingAreas ? 1000 : padding * 2 + filas * (alto + gap);

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);

  // tooltip único
  let tooltip = document.getElementById("__map_tooltip");
  if (!tooltip) {
    tooltip = create("div", false);
    tooltip.id = "__map_tooltip";
    tooltip.className = "tooltip";
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
  }

  // ---------- dibujar ----------
  function attachEvents(rect, id) {
    rect.addEventListener("mouseenter", (ev) => {
      const data = lookup[id];
      const raw = (data && data.raw) ? data.raw : "Sin datos";
      tooltip.style.display = "block";
      tooltip.innerHTML =
        `<strong>${id}</strong>` +
        `<div style="margin-top:6px; color:#475569;">${raw}</div>` +
        `<div style="margin-top:8px"><button data-key="${id}" class="openSide">Ver detalles</button></div>`;
      const bbox = ev.target.getBoundingClientRect();
      tooltip.style.left = `${bbox.right + 10}px`;
      tooltip.style.top = `${Math.max(8, bbox.top)}px`;
    });
    rect.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
    rect.addEventListener("click", () => {
      const data = lookup[id];
      if (data) { focusOnElement(id); showSide(data); }
    });
  }

  if (usingAreas) {
    // plano real
    // (pon un background con el plano si quieres en CSS: #svgContainer{background:url('/static/mapa.png') center/contain no-repeat})
    areasResp.areas.forEach((a) => {
      const x = a.x0 * W, y = a.y0 * H;
      const w = (a.x1 - a.x0) * W, h = (a.y1 - a.y0) * H;
      const id = `F${a.estanteria}-A${a.anaquel}`;

      const rect = create("rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", w);
      rect.setAttribute("height", h);
      rect.setAttribute("rx", 10);
      rect.setAttribute("class", "rect-anaquel");
      rect.setAttribute("id", id);

      // color por clase Dewey si hay dato
      const data = lookup[id];
      if (data && data.start != null) {
        const cls = String(Math.floor(data.start)).charAt(0) || "default";
        rect.style.fill = colorByClass[cls] || colorByClass.default;
      }

      const text = create("text");
      text.setAttribute("x", x + w / 2);
      text.setAttribute("y", y + h / 2 + 6);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "label");
      text.textContent = id;

      svg.appendChild(rect);
      svg.appendChild(text);
      attachEvents(rect, id);
    });
  } else {
    // grilla sintética
    for (let f = 1; f <= filas; f++) {
      for (let c = 1; c <= columnas; c++) {
        const x = padding + (c - 1) * (ancho + gap);
        const y = padding + (f - 1) * (alto + gap);
        const id = `F${f}-A${c}`;

        const rect = create("rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", ancho);
        rect.setAttribute("height", alto);
        rect.setAttribute("rx", 10);
        rect.setAttribute("class", "rect-anaquel");
        rect.setAttribute("id", id);

        // color por clase si se conoce
        const data = lookup[id];
        if (data && data.start != null) {
          const cls = String(Math.floor(data.start)).charAt(0) || "default";
          rect.style.fill = colorByClass[cls] || colorByClass.default;
        }

        const text = create("text");
        text.setAttribute("x", x + ancho / 2);
        text.setAttribute("y", y + alto / 2 + 6);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "label");
        text.textContent = id;

        svg.appendChild(rect);
        svg.appendChild(text);
        attachEvents(rect, id);
      }
    }
  }

  // ---------- leyenda ----------
  const legendEl = document.getElementById("legend");
  if (legendEl) {
    const seen = new Set();
    rows.forEach((r) => {
      let cls = "default";
      if (r.start != null) {
        const first = String(Math.floor(r.start)).charAt(0);
        cls = first || "default";
      }
      if (seen.has(cls)) return;
      seen.add(cls);

      const div = document.createElement("div");
      div.className = "flex items-center gap-2";
      const sw = document.createElement("span");
      sw.style.width = "18px";
      sw.style.height = "18px";
      sw.style.borderRadius = "6px";
      sw.style.display = "inline-block";
      sw.style.background = colorByClass[cls] || colorByClass.default;
      const label = document.createElement("span");
      label.textContent = cls === "default" ? "Otras" : `Sección ${cls}xx`;
      label.className = "text-sm text-slate-700";
      div.append(sw, label);
      legendEl.appendChild(div);
    });
  }

  // ---------- pan / zoom ----------
  let [vx, vy, vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
  function setVB(x, y, w, h) { svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`); vx = x; vy = y; vw = w; vh = h; }

  function animateView(sx, sy, sw, sh, tx, ty, tw, th, dur) {
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setVB(sx + (tx - sx) * ease, sy + (ty - sy) * ease, sw + (tw - sw) * ease, sh + (th - sh) * ease);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function focusOnElement(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const b = el.getBBox();
    const tw = Math.min(vw, b.width * 4);
    const th = Math.min(vh, b.height * 4);
    const tx = Math.max(0, b.x + b.width / 2 - tw / 2);
    const ty = Math.max(0, b.y + b.height / 2 - th / 2);
    animateView(vx, vy, vw, vh, tx, ty, tw, th, 400);
    clearHighlights();
    el.classList.add("highlight");
  }

  function clearHighlights() {
    document.querySelectorAll(".rect-anaquel").forEach((r) => r.classList.remove("highlight"));
  }
  function fitAll() { animateView(vx, vy, vw, vh, 0, 0, W, H, 400); clearHighlights(); }

  // zoom buttons
  q("#zoomIn")?.addEventListener("click", () =>
    animateView(vx, vy, vw, vh, vx + vw * 0.1, vy + vh * 0.1, vw * 0.8, vh * 0.8, 300)
  );
  q("#zoomOut")?.addEventListener("click", () =>
    animateView(vx, vy, vw, vh, Math.max(0, vx - vw * 0.1), Math.max(0, vy - vh * 0.1), vw * 1.2, vh * 1.2, 300)
  );
  q("#fitAll")?.addEventListener("click", fitAll);

  // drag to pan
  let dragging = false, start = null;
  svg.addEventListener("pointerdown", (e) => {
    svg.setPointerCapture(e.pointerId);
    dragging = true; start = { cx: e.clientX, cy: e.clientY, x: vx, y: vy };
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = ((e.clientX - start.cx) / container.clientWidth) * vw;
    const dy = ((e.clientY - start.cy) / container.clientHeight) * vh;
    setVB(start.x - dx, start.y - dy, vw, vh);
  });
  svg.addEventListener("pointerup", () => (dragging = false));
  svg.addEventListener("pointerleave", () => (dragging = false));

  // wheel zoom hacia cursor
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const scale = e.deltaY < 0 ? 0.9 : 1.1;
    const rect = container.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const nw = Math.max(200, Math.min(W, vw * scale));
    const nh = Math.max(200, Math.min(H, vh * scale));
    const cx = vx + vw * px, cy = vy + vh * py;
    const nx = cx - nw * px, ny = cy - nh * py;
    setVB(Math.max(0, nx), Math.max(0, ny), nw, nh);
  }, { passive: false });

  // ---------- panel lateral ----------
  const side = q("#sideInfo");
  function showSide(data) {
    q("#sideContent").innerHTML =
      `<h3 class="font-semibold">F${data.estanteria} - A${data.anaquel}</h3>` +
      `<div style="margin-top:6px;color:#475569">${data.raw || "Sin datos"}</div>` +
      `<div style="margin-top:10px" class="text-xs text-slate-500">Rango: ${data.start ?? "-"} — ${data.end ?? "-"}</div>`;
    side?.classList.remove("hidden");
  }
  q("#closeSide")?.addEventListener("click", () => side?.classList.add("hidden"));

  // ---------- búsqueda ----------
  function setInfoChip(kind, html) {
    const box = q("#infoBox");
    if (!box) return;
    box.innerHTML = (kind === "ok" ? "✅ " : kind === "warn" ? "🔎 " : kind === "err" ? "❌ " : "") + html;
  }

  async function searchTerm(term) {
    clearHighlights();
    q("#matchesList").innerHTML = "";
    if (!term) {
      setInfoChip("warn", "Ingresa un código Dewey para buscar.");
      return;
    }

    // número con punto o coma
    const m = term.match(/\d+(?:[.,]\d+)?/);
    let code = null;
    if (m) code = parseFloat(m[0].replace(",", "."));

    // 1) Intenta con la API (si existe) usando número
    if (code != null) {
      try {
        const r = await fetch(`/api/search?dewey=${encodeURIComponent(code)}`).then((x) => x.json());
        if (r?.ok && r.found) {
          const key = `F${r.location.estanteria}-A${r.location.anaquel}`;
          setInfoChip("ok", `Encontrado: <strong>${key}</strong>`);
          focusOnElement(key);
          showSide(lookup[key] || {
            estanteria: r.location.estanteria,
            anaquel: r.location.anaquel,
            raw: r.location.raw,
            start: r.location.rango?.[0],
            end: r.location.rango?.[1]
          });
          return;
        }
      } catch (_) { /* continúa con fallback */ }

      // 2) Fallback local exacto por rango
      const found = fuseList.find(
        (r) => r.start != null && r.end != null && r.start <= code && code <= r.end
      );
      if (found) {
        const key = `F${found.estanteria}-A${found.anaquel}`;
        setInfoChip("ok", `Encontrado: <strong>${key}</strong>`);
        focusOnElement(key);
        showSide(found);
        addMatchToList(found);
        return;
      }
    }

    // 3) Fuzzy por texto
    const res = fuse.search(term);
    if (res?.length) {
      setInfoChip("warn", `${res.length} coincidencia(s). Selecciona una:`);
      res.slice(0, 8).forEach((r) => addMatchToList(r.item));
    } else {
      setInfoChip("err", "No se encontró coincidencia.");
    }
  }

  function addMatchToList(item) {
    const li = document.createElement("li");
    li.className = "p-2 rounded hover:bg-slate-50 flex justify-between items-center";
    li.innerHTML = `
      <div>
        <div class="font-medium">F${item.estanteria} - A${item.anaquel}</div>
        <div class="text-xs text-slate-500">${item.raw || ""}</div>
      </div>
      <div class="flex flex-col gap-1">
        <button class="btnGo text-xs" data-key="F${item.estanteria}-A${item.anaquel}">Ir</button>
      </div>`;
    q("#matchesList").appendChild(li);
    li.querySelector(".btnGo").addEventListener("click", (e) => {
      const key = e.target.dataset.key;
      focusOnElement(key);
      showSide(lookup[key]);
    });
  }

  // wire UI
  q("#btnSearch")?.addEventListener("click", () => searchTerm(q("#searchInput").value.trim()));
  q("#btnClear")?.addEventListener("click", () => {
    q("#searchInput").value = "";
    fitAll();
    q("#matchesList").innerHTML = "";
    setInfoChip("", "Ingresa un código Dewey para buscar.");
  });
  q("#searchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchTerm(e.target.value.trim());
  });

  // click en botón del tooltip
  document.body.addEventListener("click", (e) => {
    if (e.target && e.target.matches("button.openSide")) {
      const k = e.target.dataset.key;
      if (k && lookup[k]) showSide(lookup[k]);
    }
  });

  // inicial
  fitAll();

  // deep-link ?q=...
  const qp = new URLSearchParams(location.search).get("q");
  if (qp) { q("#searchInput").value = qp; searchTerm(qp); }
})();
