# app.py
from flask import Flask, render_template, jsonify, send_from_directory, request
from pathlib import Path
import pandas as pd
import re, os, logging, csv, secrets

# --- Rutas base ---
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
EXCEL_PATH = DATA_DIR / "Biblioteca MHC.xlsx"
MAPCSV_PATH = DATA_DIR / "mapping.csv"

# --- Inicialización Flask ---
CANDIDATE_TPL = [PROJECT_ROOT / "templates", BASE_DIR / "templates"]
CANDIDATE_STA = [PROJECT_ROOT / "static",    BASE_DIR / "static"]
TEMPLATES_DIR = next((p for p in CANDIDATE_TPL if p.exists()), CANDIDATE_TPL[0])
STATIC_DIR    = next((p for p in CANDIDATE_STA if p.exists()), CANDIDATE_STA[0])

app = Flask(__name__, template_folder=str(TEMPLATES_DIR), static_folder=str(STATIC_DIR))

# --- Configuración segura ---
app.config.update(
    SECRET_KEY=os.getenv("SECRET_KEY") or secrets.token_urlsafe(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(os.getenv("FLASK_ENV") == "production"),
)

# --- Logging ---
app.logger.setLevel(logging.INFO)
app.logger.info("📂 Templates: %s (exists=%s)", TEMPLATES_DIR, TEMPLATES_DIR.exists())
app.logger.info("📂 Static    : %s (exists=%s)", STATIC_DIR, STATIC_DIR.exists())

# --- Asegura carpeta data ---
DATA_DIR.mkdir(parents=True, exist_ok=True)

# --- Constantes / regex ---
NUM_RE = re.compile(r'\d+(?:[.,]\d+)?')
SEP_RE = re.compile(r'\s*(?:-|–|—|->|→|hasta|a)\s*', flags=re.IGNORECASE)
EPS = 1e-6  # tolerancia flotante

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
    """Convierte celdas tipo '001.2 - 005.3' a (start, end, raw)."""
    if cell_text is None or (isinstance(cell_text, float) and pd.isna(cell_text)):
        return (None, None, "")
    raw = str(cell_text).strip()
    if not raw:
        return (None, None, raw)
    parts = SEP_RE.split(raw)
    start_tok = extract_first_dewey_token(parts[0]) if parts else None
    end_tok   = extract_first_dewey_token(parts[-1]) if len(parts) > 1 else None
    start     = to_float(start_tok)
    end       = to_float(end_tok) if end_tok else start
    if (start is not None) and (end is not None) and start > end:
        start, end = end, start
    return (start, end, raw)

# === Carga de datos ===
def load_locations_from_excel(path: Path):
    if not path.exists():
        return {"error": "excel_not_found", "path": str(path)}
    try:
        df = pd.ExcelFile(path).parse(0)
    except Exception as e:
        return {"error": "excel_read_error", "details": str(e)}

    cols = {str(c).strip(): c for c in df.columns}
    rows = []

    def has(*names): return all(n in cols for n in names)

    if has("RangoInicio", "RangoFin", "Pasillo", "Lado", "Estantería", "Anaquel"):
        # --- Formato LARGO ---
        for _, r in df.iterrows():
            start = to_float(r[cols["RangoInicio"]])
            end   = to_float(r[cols["RangoFin"]])
            pas   = str(r[cols["Pasillo"]]).strip() if not pd.isna(r[cols["Pasillo"]]) else ""
            lado  = str(r[cols["Lado"]]).strip() if not pd.isna(r[cols["Lado"]]) else "A"
            est   = int(r[cols["Estantería"]]) if not pd.isna(r[cols["Estantería"]]) else None
            ana   = int(r[cols["Anaquel"]])    if not pd.isna(r[cols["Anaquel"]])    else None
            raw   = str(r.get(cols.get("TextoOriginal", ""), ""))
            if (start is None) or (end is None) or (est is None) or (ana is None):
                continue
            rows.append({
                "pasillo": pas, "lado": (lado or "A"),
                "estanteria": est, "anaquel": ana,
                "start": start, "end": end, "raw": raw
            })
    else:
        # --- Formato ANCHO ---
        est_col  = df.columns[0]
        ana_cols = [c for c in df.columns if 'ANAQUEL' in str(c).upper()]
        if not ana_cols:
            ana_cols = list(df.columns[1:6])  # fallback
        for idx, r in df.iterrows():
            est_raw = r.get(est_col, "")
            m = re.search(r'(\d+)', str(est_raw)) if isinstance(est_raw, str) else None
            est = int(m.group(1)) if m else (idx + 1)
            for j, col in enumerate(ana_cols, start=1):
                start, end, raw = parse_range_cell(r.get(col, ""))
                if (start is None) or (end is None):
                    continue
                rows.append({
                    "pasillo": "", "lado": "A",
                    "estanteria": est, "anaquel": j,
                    "start": start, "end": end, "raw": raw
                })

    max_est = max((r["estanteria"] for r in rows), default=0)
    max_ana = max((r["anaquel"]    for r in rows), default=0)
    return {"rows": rows, "max_estanteria": int(max_est), "max_anaquel": int(max_ana)}

def load_map_areas(csv_path: Path):
    """mapping.csv: pasillo,lado,estanteria,anaquel,x0,y0,x1,y1 (valores 0..1 o px)"""
    if not csv_path.exists():
        return {}
    areas = {}
    with open(csv_path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            try:
                pas   = (r.get("pasillo","") or "").strip()
                lado  = (r.get("lado","A") or "A").strip()
                est   = int(float(r.get("estanteria", 0)))
                ana   = int(float(r.get("anaquel",    0)))
                bbox  = {k: float(r[k]) for k in ("x0","y0","x1","y1")}
                areas[(pas, lado, est, ana)] = bbox
            except Exception:
                continue
    return areas

# === Cache global ===
LOC_CACHE  = load_locations_from_excel(EXCEL_PATH)
AREA_CACHE = load_map_areas(MAPCSV_PATH)
app.logger.info("✅ Excel filas: %s | áreas de mapa: %s",
                len(LOC_CACHE.get("rows", [])), len(AREA_CACHE))

# === Filtros de filas (estanterías) ===
def _parse_est_list(s):
    if not s: return None
    out = []
    for tok in s.split(','):
        tok = tok.strip()
        if not tok:
            continue
        try:
            out.append(int(tok))
        except:
            pass
    return out or None

def _filter_rows(rows, est_in=None, pasillo=None, lado=None):
    r = rows
    if est_in:
        estset = set(est_in)
        r = [x for x in r if x.get("estanteria") in estset]
    if pasillo not in (None, ""):
        r = [x for x in r if str(x.get("pasillo","")) == str(pasillo)]
    if lado not in (None, ""):
        r = [x for x in r if (str(x.get("lado","A")) or "A").upper() == str(lado).upper()]
    return r

# === Búsqueda Dewey ===
def parse_dewey_query(q):
    tok = extract_first_dewey_token(q)
    return to_float(tok)

def find_location_in_rows(rows, d):
    """Busca dentro de un subconjunto de filas ya filtradas."""
    for r in rows:
        s, e = r.get("start"), r.get("end")
        if (s is None) or (e is None): 
            continue
        if (s - EPS) <= d <= (e + EPS):
            key = (str(r.get("pasillo","")).strip(),
                   str(r.get("lado","A") or "A").strip(),
                   r["estanteria"], r["anaquel"])
            return r, AREA_CACHE.get(key)
    return None, None

# === Rutas ===
@app.get("/health")
def health():
    return jsonify({"ok": True, "status": "healthy"})

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/mapping.json")
def mapping_json():
    # Filtro por estanterías/pasillo/lado
    est_qs  = request.args.get("est") or os.getenv("DEFAULT_ESTANTERIAS","")  # ej: "3,4,5,6"
    est_in  = _parse_est_list(est_qs)
    pasillo = request.args.get("pasillo")
    lado    = request.args.get("lado")

    all_rows = LOC_CACHE.get("rows", [])
    rows = _filter_rows(all_rows, est_in=est_in, pasillo=pasillo, lado=lado)
    max_est = max((r["estanteria"] for r in rows), default=0)
    max_ana = max((r["anaquel"]    for r in rows), default=0)
    return jsonify({"rows": rows, "max_estanteria": int(max_est), "max_anaquel": int(max_ana)})

@app.get("/api/search")
def api_search():
    q = request.args.get("dewey", "")
    d = parse_dewey_query(q)
    if d is None:
        return jsonify({"ok": False, "error": "Número Dewey inválido"}), 400

    # respetar el mismo filtro que mapping.json
    est_in  = _parse_est_list(request.args.get("est") or os.getenv("DEFAULT_ESTANTERIAS",""))
    pasillo = request.args.get("pasillo")
    lado    = request.args.get("lado")
    rows = _filter_rows(LOC_CACHE.get("rows", []), est_in=est_in, pasillo=pasillo, lado=lado)

    r, bbox = find_location_in_rows(rows, d)
    if not r:
        return jsonify({"ok": True, "found": False})
    return jsonify({"ok": True, "found": True, "location": r, "bbox": bbox})

@app.post("/api/reload")
def api_reload():
    """Recarga Excel y CSV sin reiniciar (útil en Render)."""
    global LOC_CACHE, AREA_CACHE
    LOC_CACHE  = load_locations_from_excel(EXCEL_PATH)
    AREA_CACHE = load_map_areas(MAPCSV_PATH)
    app.logger.info("♻️ Recargado Excel y mapping.csv")
    return jsonify({"ok": True, "rows": len(LOC_CACHE.get('rows', [])), "areas": len(AREA_CACHE)})

@app.route('/static/<path:p>')
def serve_static(p):
    # Flask ya sirve /static, esta ruta explicita ayuda si usas reverse proxy
    return send_from_directory(app.static_folder, p)

# === Main ===
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=(os.getenv("FLASK_ENV") != "production"), host="0.0.0.0", port=port)
