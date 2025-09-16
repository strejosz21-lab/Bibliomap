const SVG_NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("map-svg");
const PASILLOS = 8; const EST_SIDE = 6; const ANAC = 5;
const PASILLO_WIDTH = 140; const PASILLO_GAP = 16; const ANA_HEIGHT = 18; const EST_WIDTH = 34;
const START_X = 40; const START_Y = 80;
const totalWidth = START_X*2 + PASILLOS*PASILLO_WIDTH + (PASILLOS-1)*PASILLO_GAP;
svg.setAttribute("viewBox", `0 0 ${totalWidth+160} 700`);
function ce(t, attrs={}){ const e = document.createElementNS(SVG_NS, t); Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v)); return e; }
for(let p=1;p<=PASILLOS;p++){ const baseX = START_X + (p-1)*(PASILLO_WIDTH+PASILLO_GAP); const midX = baseX + PASILLO_WIDTH/2;
  const label = ce("text",{x:midX,y:START_Y-40,"text-anchor":"middle","class":"label"}); label.textContent = `Fila ${p}`; svg.appendChild(label);
  const leftStart = baseX + 8;
  for(let e=1;e<=EST_SIDE;e++){ const estBaseX = leftStart + (e-1)*(EST_WIDTH+8);
    for(let a=1;a<=ANAC;a++){ const ay = START_Y + (a-1)*(ANA_HEIGHT+6); const id = `P${p}-L-E${e}-A${a}`;
      const rect = ce("rect",{id:id, x:estBaseX, y:ay, width:EST_WIDTH, height:ANA_HEIGHT, class:"rect-anaquel"}); svg.appendChild(rect);
      const lab = ce("text",{x:estBaseX+EST_WIDTH/2, y:ay+12, "text-anchor":"middle", "class":"label"}); lab.textContent = `F${p}-E${e}-A${a}`; svg.appendChild(lab);
    }
  }
  const rightStart = baseX + PASILLO_WIDTH - (EST_SIDE*(EST_WIDTH+8)) - 8;
  for(let e=1;e<=EST_SIDE;e++){ const estBaseX = rightStart + (e-1)*(EST_WIDTH+8);
    for(let a=1;a<=ANAC;a++){ const ay = START_Y + (a-1)*(ANA_HEIGHT+6); const id = `P${p}-R-E${e}-A${a}`;
      const rect = ce("rect",{id:id, x:estBaseX, y:ay, width:EST_WIDTH, height:ANA_HEIGHT, class:"rect-anaquel"}); svg.appendChild(rect);
      const lab = ce("text",{x:estBaseX+EST_WIDTH/2, y:ay+12, "text-anchor":"middle", "class":"label"}); lab.textContent = `F${p}-E${e}-A${a}`; svg.appendChild(lab);
    }
  }
}
async function search(q){ if(!q) return; const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`); const j = await res.json();
  const infoDiv = document.getElementById("info"); const resultsDiv = document.getElementById("search-results"); resultsDiv.innerHTML = "";
  if(!j.ok){ infoDiv.innerText = j.error || "No encontrado"; return; }
  if(j.type === "dewey"){ const id = `P${j.pasillo}-${j.lado}-E${j.estanteria}-A${j.anaquel}`; highlight(id);
    infoDiv.innerText = `Ubicación: Fila ${j.pasillo} | Lado ${j.lado} | Estantería ${j.estanteria} | Anaquel ${j.anaquel}`;
    const pre = document.createElement("pre"); pre.className="text-xs mt-2 text-gray-600"; pre.innerText = `Raw: ${j.raw}`; resultsDiv.appendChild(pre);
  }
}
function highlight(id){ document.querySelectorAll(".highlight").forEach(el=>el.classList.remove("highlight")); const el = document.getElementById(id); if(el){ el.classList.add("highlight"); } }
document.getElementById("btn").addEventListener("click", ()=> search(document.getElementById("q").value));
document.getElementById("clear").addEventListener("click", ()=> { document.querySelectorAll(".highlight").forEach(el=>el.classList.remove("highlight")); document.getElementById("info").innerText = "Ingresa un código Dewey y presiona Buscar."; document.getElementById("search-results").innerHTML = ""; });
document.getElementById("q").addEventListener("keyup", (e)=> { if(e.key === "Enter") search(e.target.value); });
