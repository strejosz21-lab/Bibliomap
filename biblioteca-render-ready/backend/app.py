# app.py
from flask import Flask, render_template, jsonify, send_from_directory, request
from pathlib import Path
import pandas as pd
import re, os, logging, csv, secrets

# === Configuración de rutas ===
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"

# Buscar automáticamente el Excel más reciente
EXCEL_PATH = next((p for p in DATA_DIR.glob("Biblioteca_MHC*.xlsx")), DATA_DIR / "Biblioteca_MHC.xlsx")
MAPCSV_PATH = DATA_DIR / "mapping.csv"

# === Inicialización Flask ===
CANDIDATE_TPL = [PROJECT_ROOT / "templates", BASE_DIR / "templates"]
CANDIDATE_STA = [PROJECT_ROOT / "static", BASE_DIR / "static"]
TEMPLATES_DIR = next((p for p in CANDIDATE_TPL if p.exists()), CANDIDATE_TPL[0])
STATIC_DIR = next((p for p in CANDIDATE_STA if p.exists()), CANDIDATE_STA[0])

app = Flask(__name__, template_folder=str(TEMPLATES_DIR), static_folder=str(STATIC_DIR))
app.config.update(
    SECRET_KEY=os.getenv("SECRET_KEY") or secrets.token_urlsafe(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(os.getenv("FLASK_ENV") == "production"),
)

# === Logging ===
app.logger.setLevel(logging.INFO)
app.logger.info(f"📁 Templates: {TEMPLATES_DIR} (exists={TEMPLATES_DIR.exists()})")
app.logger.info(f"📁 Static   : {STATIC_DIR} (exists={STATIC_DIR.exists()})")
DATA_DIR.mkdir(parents=True, exist_ok=True)

# === Expresiones regulares ===
NUM_RE = re.compile(r'\d+(?:[.,]\d+)?')
SEP_RE = re.compile(r'\s*(?:-|–|—|->|→|hasta|a)\s*', flags=re.IGNORECASE)
EPS = 1e-6

# === Funciones auxiliares ===
def extract_first_dewey_token(s):
    if not s:
        return None
    m = NUM_RE.search(str(s))
    return m.group(0) if m else None

def to_float(tok):
    try:
        return float(str(tok).replace(',', '.'))
    except Exception:
        return None

def parse_range_cell(cell_text):
    if cell_text is None or (isinstance(cell_text, float) and pd.isna(cell_text)):
        return (None, None, "")
    raw = str(cell_text).strip()
    if not raw:
        return (None, None, raw)
    parts = SEP_RE.split(raw)
    start_tok = extract_first_dewey_token(parts[0]) if parts else None
    end_tok = extract_first_dewey_token(parts[-1]) if len(parts) > 1 else None
    start = to_float(start_tok)
    end = to_float(end_tok) if end_tok else start
    if start and end and start > end:
        start, end = end, start
    return (start, end, raw)

# === Lectura del Excel ===
def load_locations_from_excel(path: Path):
    if not path.exists():
        app.logger.warning(f"⚠️ Excel no encontrado: {path}")
        return {"rows": [], "max_estanteria": 0, "max_anaquel": 0}

    try:
        df = pd.ExcelFile(path).parse(0)
    except Exception as e:
        app.logger.error(f"❌ Error leyendo Excel: {e}")
        return {"rows": [], "max_estanteria": 0, "max_anaquel": 0}

    # Normalizar nombres de columnas
    df.columns = [str(c).strip().title() for c in df.columns]
    cols = {c.lower(): c for c in df.columns}
    rows = []

    for _, r in df.iterrows():
        start = to_float(r.get(cols.get("rangoinicio", "")))
        end = to_float(r.get(cols.get("rangofin", "")))
        pas = str(r.get(cols.get("pasillo", ""), "")).strip()
        lado = str(r.get(cols.get("lado", "A"), "A")).strip() or "A"
        est = r.get(cols.get("estantería", None)) or r.get(cols.get("estanteria", None))
        ana = r.get(cols.get("anaquel", None))
        raw = str(r.get(cols.get("textooriginal", ""), ""))

        if None in (start, end, est, ana):
            continue

        try:
            est = int(est)
            ana = int(ana)
        except:
            continue

        rows.append({
            "pasillo": pas,
            "lado": lado,
            "estanteria": est,
            "anaquel": ana,
            "start": start,
            "end": end,
            "raw": raw
        })

    max_est = max((r["estanteria"] for r in rows), default=0)
    max_ana = max((r["anaquel"] for r in rows), default=0)
    app.logger.info(f"📘 Cargadas {len(rows)} filas desde {path.name}")
    return {"rows": rows, "max_estanteria": int(max_est), "max_anaquel": int(max_ana)}

# === Carga del CSV de mapa ===
def load_map_areas(csv_path: Path):
    if not csv_path.exists():
        app.logger.warning(f"⚠️ mapping.csv no encontrado: {csv_path}")
        return {}
    areas = {}
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            try:
                pas = (r.get("pasillo", "") or "").strip()
                lado = (r.get("lado", "A") or "A").strip()
                est = int(float(r.get("estanteria", 0)))
                ana = int(float(r.get("anaquel", 0)))
                bbox = {k: float(r[k]) for k in ("x0", "y0", "x1", "y1")}
                areas[(pas, lado, est, ana)] = bbox
            except Exception:
                continue
    return areas

# === Cache inicial ===
LOC_CACHE = load_locations_from_excel(EXCEL_PATH)
AREA_CACHE = load_map_areas(MAPCSV_PATH)
app.logger.info(f"✅ Excel filas: {len(LOC_CACHE.get('rows', []))} | Áreas de mapa: {len(AREA_CACHE)}")

# === Funciones de búsqueda ===
def parse_dewey_query(q):
    tok = extract_first_dewey_token(q)
    return to_float(tok)

def find_location_in_rows(rows, d):
    for r in rows:
        s, e = r.get("start"), r.get("end")
        if None in (s, e): 
            continue
        if (s - EPS) <= d <= (e + EPS):
            key = (str(r.get("pasillo", "")).strip(), str(r.get("lado", "A") or "A").strip(), r["estanteria"], r["anaquel"])
            return r, AREA_CACHE.get(key)
    return None, None

# === Rutas ===
@app.get("/health")
def health():
    return jsonify({"ok": True, "status": "healthy"})

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/search")
def api_search():
    q = request.args.get("dewey", "")
    d = parse_dewey_query(q)
    if d is None:
        return jsonify({"ok": False, "error": "Número Dewey inválido"}), 400
    r, bbox = find_location_in_rows(LOC_CACHE.get("rows", []), d)
    if not r:
        return jsonify({"ok": True, "found": False})
    return jsonify({"ok": True, "found": True, "location": r, "bbox": bbox})

@app.post("/api/reload")
def api_reload():
    global LOC_CACHE, AREA_CACHE
    LOC_CACHE = load_locations_from_excel(EXCEL_PATH)
    AREA_CACHE = load_map_areas(MAPCSV_PATH)
    app.logger.info("♻️ Recargado Excel y mapping.csv")
    return jsonify({"ok": True, "rows": len(LOC_CACHE.get('rows', [])), "areas": len(AREA_CACHE)})

@app.route('/static/<path:p>')
def serve_static(p):
    return send_from_directory(app.static_folder, p)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))

