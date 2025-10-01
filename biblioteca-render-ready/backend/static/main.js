// main.js
async function fetchMapping() {
  const res = await fetch("/mapping.json");
  return await res.json();
}

(function(){ // scope
  async function init() {
    const mappingData = await fetchMapping();
    if (mappingData.error) {
      document.getElementById("info").textContent = "Error cargando el mapping: " + mappingData.error;
      return;
    }

    const rows = mappingData.rows || [];
    const filas = mappingData.max_estante || 6;
    const columnas = mappingData.total_anaqueles || 5;

    const svg = document.getElementById("mapaSvg");
    const ancho = 120;
    const alto = 60;
    const gap = 14;
    const padding = 40;
    const svgWidth = Math.max(900, (ancho + gap) * columnas + padding * 2);
    const svgHeight = (alto + gap) * filas + padding * 2;
    svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    svg.setAttribute("height", svgHeight);

    const lookup = {};
    rows.forEach(r => {
      if (r.estante == null) return;
      const key = `F${r.estante}-A${r.anaquel}`;
      lookup[key] = r;
    });

    for (let f = 1; f <= filas; f++) {
      for (let c = 1; c <= columnas; c++) {
        const x = padding + (c - 1) * (ancho + gap);
        const y = padding + (f - 1) * (alto + gap);

        const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", ancho);
        rect.setAttribute("height", alto);
        rect.setAttribute("rx", 8);
        rect.setAttribute("class", "rect-anaquel");
        rect.setAttribute("id", `F${f}-A${c}`);
        svg.appendChild(rect);

        const text = document.createElementNS("http://www.w3.org/2000/svg","text");
        text.setAttribute("x", x + ancho/2);
        text.setAttribute("y", y + alto/2 + 4);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "label");
        text.textContent = `F${f}-A${c}`;
        svg.appendChild(text);

        // tooltip behavior
        rect.addEventListener("mouseenter", (ev) => {
          const key = `F${f}-A${c}`;
          const data = lookup[key];
          let tip = document.getElementById("__map_tooltip");
          if (!tip) {
            tip = document.createElement("div");
            tip.id = "__map_tooltip";
            tip.className = "tooltip";
            document.body.appendChild(tip);
          }
          tip.style.display = "block";
          tip.innerHTML = `<b>${key}</b><div style="margin-top:6px; max-width:260px;">${data ? data.raw : "Sin datos"}</div>`;
          const rectbox = ev.target.getBoundingClientRect();
          tip.style.left = (rectbox.right + 8) + "px";
          tip.style.top = (rectbox.top) + "px";
        });
        rect.addEventListener("mouseleave", () => {
          const tip = document.getElementById("__map_tooltip");
          if (tip) tip.style.display = "none";
        });

        rect.addEventListener("click", () => {
          const key = `F${f}-A${c}`;
          const data = lookup[key];
          const info = document.getElementById("info");
          info.innerHTML = `<b>${key}</b> — ${data ? data.raw : 'Sin datos'}`;
        });
      }
    }

    function clearHighlights() {
      document.querySelectorAll(".rect-anaquel").forEach(e => e.classList.remove("highlight"));
    }

    function buscar(codigoRaw) {
      clearHighlights();
      if (!codigoRaw) {
        document.getElementById("info").textContent = "Ingresa un código Dewey para buscar.";
        return;
      }
      const m = codigoRaw.match(/\d+(?:\.\d+)?/);
      if (!m) {
        document.getElementById("info").textContent = "Código inválido.";
        return;
      }
      const code = parseFloat(m[0]);

      let found = null;
      for (const r of rows) {
        if (r.start == null || r.end == null) continue;
        if (r.start <= code && code <= r.end) {
          found = r;
          break;
        }
      }

      if (found) {
        const id = `F${found.estante}-A${found.anaquel}`;
        const el = document.getElementById(id);
        if (el) {
          el.classList.add("highlight");
          // scroll wrapper to show element
          const wrapper = document.getElementById("mapWrapper");
          const elRect = el.getBoundingClientRect();
          const wrapperRect = wrapper.getBoundingClientRect();
          const left = Math.max(0, elRect.left - wrapperRect.left - 80);
          const top = Math.max(0, elRect.top - wrapperRect.top - 80);
          wrapper.scrollTo({left, top, behavior: 'smooth'});
        }
        document.getElementById("info").innerHTML = `📍 Encontrado en <b>Fila ${found.estante}</b> — Estante <b>A${found.anaquel}</b><div style="margin-top:6px;">${found.raw}</div>`;
      } else {
        document.getElementById("info").textContent = "❌ No se encontró el código en ningún anaquel.";
      }
    }

    document.getElementById("btnBuscar").addEventListener("click", () => {
      buscar(document.getElementById("codigo").value);
    });
    document.getElementById("btnLimpiar").addEventListener("click", () => {
      document.getElementById("codigo").value = "";
      clearHighlights();
      document.getElementById("info").textContent = "Ingresa un código Dewey y presiona Buscar.";
    });
    document.getElementById("codigo").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        buscar(e.target.value);
      }
    });

  } // init

  init();
})();
