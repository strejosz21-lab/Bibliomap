// main.js – BiblioMap v2 (versión optimizada y modular)
// Requiere: mapping.json servido por el backend Flask + Fuse.js CDN

(async () => {
  /** ---------- UTILIDADES ---------- **/
  const $ = (sel) => document.querySelector(sel);
  const create = (tag, ns = true) =>
    ns ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);

  const COLORS = {
    "0": "#6366f1",
    "1": "#7c3aed",
    "2": "#0ea5a4",
    "3": "#06b6d4",
    "4": "#f97316",
    "5": "#ef4444",
    "6": "#f59e0b",
    "7": "#10b981",
    "8": "#6366f1",
    "9": "#a78bfa",
    default: "#94a3b8",
  };

  /** ---------- CARGA DE DATOS ---------- **/
  async function fetchMapping() {
    try {
      const res = await fetch("/mapping.json");
      if (!res.ok) throw new Error("No se pudo cargar mapping.json");
      return await res.json();
    } catch (err) {
      console.error("Error cargando mapping:", err);
      return { error: err.message };
    }
  }

  const mapping = await fetchMapping();
  if (mapping.error) {
    $("#infoBox").textContent = "❌ Error cargando mapping: " + mapping.error;
    return;
  }

  const rows = mapping.rows || [];
  const filas = mapping.max_estante || 10;
  const columnas = mapping.total_anaqueles || 5;

  /** ---------- PREPARAR BUSCADOR ---------- **/
  const fuseList = rows.map((r) => ({
    key: `F${r.estante}-A${r.anaquel}`,
    ...r,
  }));

  const fuse = new Fuse(fuseList, {
    keys: ["raw", "key"],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  /** ---------- SVG Y LAYOUT ---------- **/
  const svg = $("#mapSvg");
  const PAD = 48, W = 140, H = 70, GAP = 18;
  const svgW = Math.max(1000, PAD * 2 + columnas * (W + GAP));
  const svgH = PAD * 2 + filas * (H + GAP);
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  svg.setAttribute("width", svgW);
  svg.setAttribute("height", svgH);

  const lookup = Object.fromEntries(fuseList.map((r) => [r.key, r]));

  /** ---------- TOOLTIP ---------- **/
  const tooltip = (() => {
    const el = create("div", false);
    el.id = "__tooltip";
    el.className = "tooltip hidden";
    document.body.appendChild(el);
    return el;
  })();

  /** ---------- DIBUJAR MAPA ---------- **/
  for (let f = 1; f <= filas; f++) {
    for (let c = 1; c <= columnas; c++) {
      const x = PAD + (c - 1) * (W + GAP);
      const y = PAD + (f - 1) * (H + GAP);
      const id = `F${f}-A${c}`;

      const rect = create("rect");
      Object.assign(rect, {
        x, y, width: W, height: H,
      });
      rect.setAttribute("rx", 10);
      rect.id = id;
      rect.classList.add("rect-anaquel");
      svg.appendChild(rect);

      const label = create("text");
      Object.assign(label, {
        x: x + W / 2,
        y: y + H / 2 + 6,
      });
      label.textContent = id;
      label.setAttribute("text-anchor", "middle");
      label.classList.add("label");
      svg.appendChild(label);

      rect.addEventListener("mouseenter", (ev) => showTooltip(ev, id));
      rect.addEventListener("mouseleave", hideTooltip);
      rect.addEventListener("click", () => openSide(id));
    }
  }

  /** ---------- TOOLTIP FUNCIONES ---------- **/
  function showTooltip(ev, id) {
    const data = lookup[id];
    tooltip.innerHTML = `
      <strong>${id}</strong>
      <div>${data?.raw || "Sin datos"}</div>
      <button data-key="${id}" class="openSide">Ver detalles</button>
    `;
    tooltip.style.display = "block";
    const box = ev.target.getBoundingClientRect();
    tooltip.style.left = `${box.right + 10}px`;
    tooltip.style.top = `${box.top}px`;
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  /** ---------- PANEL LATERAL ---------- **/
  const side = $("#sideInfo");
  const sideContent = $("#sideContent");
  $("#closeSide").addEventListener("click", () => side.classList.add("hidden"));

  function openSide(id) {
    const data = lookup[id];
    if (!data) return;
    sideContent.innerHTML = `
      <h3>📚 F${data.estante} - A${data.anaquel}</h3>
      <p>${data.raw || "Sin descripción"}</p>
      <small>Rango: ${data.start || "-"} — ${data.end || "-"}</small>
    `;
    side.classList.remove("hidden");
    focusElement(id);
  }

  /** ---------- ZOOM / ENFOQUE ---------- **/
  let vb = svg.getAttribute("viewBox").split(" ").map(Number);
  let view = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };

  function setViewBox(x, y, w, h) {
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    view = { x, y, w, h };
  }

  function focusElement(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const box = el.getBBox();
    animateView(view.x, view.y, view.w, view.h, box.x - 20, box.y - 20, box.width * 5, box.height * 5, 400);
    clearHighlights();
    el.classList.add("highlight");
  }

  function animateView(sx, sy, sw, sh, tx, ty, tw, th, dur) {
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
    requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = ease(t);
      setViewBox(
        sx + (tx - sx) * e,
        sy + (ty - sy) * e,
        sw + (tw - sw) * e,
        sh + (th - sh) * e
      );
      if (t < 1) requestAnimationFrame(step);
    });
  }

  function clearHighlights() {
    document.querySelectorAll(".rect-anaquel").forEach((r) => r.classList.remove("highlight"));
  }

  $("#fitAll").addEventListener("click", () => animateView(view.x, view.y, view.w, view.h, 0, 0, svgW, svgH, 400));
  $("#zoomIn").addEventListener("click", () =>
    animateView(view.x, view.y, view.w, view.h, view.x + view.w * 0.1, view.y + view.h * 0.1, view.w * 0.8, view.h * 0.8, 300)
  );
  $("#zoomOut").addEventListener("click", () =>
    animateView(view.x, view.y, view.w, view.h, Math.max(0, view.x - view.w * 0.1), Math.max(0, view.y - view.h * 0.1), view.w * 1.2, view.h * 1.2, 300)
  );

  /** ---------- BÚSQUEDA ---------- **/
  function search(term) {
    clearHighlights();
    $("#matchesList").innerHTML = "";
    if (!term) return ($("#infoBox").textContent = "Ingrese un código o palabra clave.");

    const num = term.match(/\d+(\.\d+)?/);
    if (num) {
      const val = parseFloat(num[0]);
      const found = fuseList.find((r) => r.start <= val && val <= r.end);
      if (found) return showResult([found]);
    }

    const results = fuse.search(term).map((r) => r.item);
    showResult(results);
  }

  function showResult(results) {
    if (!results.length) {
      $("#infoBox").textContent = "❌ No se encontró coincidencia.";
      return;
    }
    $("#infoBox").textContent = `🔎 ${results.length} resultado(s):`;
    results.slice(0, 10).forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="font-medium">F${r.estante}-A${r.anaquel}</div>
        <div class="text-xs text-slate-500">${r.raw}</div>
        <button class="btnGo" data-key="${r.key}">Ir</button>
      `;
      li.querySelector(".btnGo").addEventListener("click", () => openSide(r.key));
      $("#matchesList").appendChild(li);
    });
  }

  $("#btnSearch").addEventListener("click", () => search($("#searchInput").value.trim()));
  $("#btnClear").addEventListener("click", () => {
    $("#searchInput").value = "";
    $("#matchesList").innerHTML = "";
    $("#infoBox").textContent = "Busque por código Dewey o palabra.";
    animateView(view.x, view.y, view.w, view.h, 0, 0, svgW, svgH, 400);
  });
  $("#searchInput").addEventListener("keydown", (e) => e.key === "Enter" && search(e.target.value.trim()));

  /** ---------- INICIO ---------- **/
  $("#infoBox").textContent = "Ingresa un código Dewey para buscar.";
})();
