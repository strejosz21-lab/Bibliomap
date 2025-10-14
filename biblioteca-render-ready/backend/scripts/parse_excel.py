import re, sqlite3, pandas as pd
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
EXCEL = BASE / "data" / "Biblioteca MHC.xlsx"
DB    = BASE / "db" / "biblioteca.db"
MAPPING = BASE / "data" / "mapping.csv"

NUM_RE = re.compile(r"\d{1,3}(?:[.,]\d+)?")
SEP_RE = re.compile(r"\s*(?:-|–|—|->|→|hasta|a|to)\s*", re.IGNORECASE)

def to_dewey(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    m = NUM_RE.search(str(v))
    return float(m.group(0).replace(",", ".")) if m else None

def parse_range(cell):
    # Devuelve (inicio, fin, raw)
    if cell is None or (isinstance(cell, float) and pd.isna(cell)): return (None, None, "")
    raw = str(cell).strip()
    if not raw: return (None, None, raw)
    parts = SEP_RE.split(raw)
    s = to_dewey(parts[0])
    e = to_dewey(parts[-1]) if len(parts) > 1 else s
    if s is not None and e is not None and s > e:
        s, e = e, s
    return s, e, raw

def create_db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB) as conn:
        c = conn.cursor()
        c.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY,
            excel_row INTEGER,
            pasillo TEXT,
            lado TEXT,
            estanteria INTEGER,
            anaquel INTEGER,
            rango_inicio REAL,
            rango_fin REAL,
            raw_text TEXT
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_rng ON locations(rango_inicio, rango_fin)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_loc ON locations(pasillo, lado, estanteria, anaquel)")
        conn.commit()

def auto_mapping_rows(n_rows, pasillos=8, lados=("A","B"), estanterias=6):
    rows = []; idx = 0
    for p in range(1, pasillos+1):
        for side in lados:
            for e in range(1, estanterias+1):
                if idx >= n_rows: return rows
                rows.append({"excel_row_index": idx, "pasillo": p, "lado": side, "estanteria": e})
                idx += 1
    return rows

def load_and_parse():
    create_db()
    if not EXCEL.exists():
        print("Excel no encontrado:", EXCEL); return

    df = pd.read_excel(EXCEL, sheet_name=0)
    ana_cols = [c for c in df.columns if "ANAQUEL" in str(c).upper()]
    if not ana_cols:
        ana_cols = list(df.columns[1:6])  # fallback

    if not MAPPING.exists():
        pd.DataFrame(auto_mapping_rows(len(df))).to_csv(MAPPING, index=False)

    map_df = pd.read_csv(MAPPING)
    # Normaliza lado a A/B si viene L/R
    map_df["lado"] = map_df["lado"].astype(str).str.upper().replace({"L": "A", "R": "B"})
    required = {"excel_row_index", "pasillo", "lado", "estanteria"}
    missing = required - set(map_df.columns)
    if missing:
        raise ValueError(f"mapping.csv faltan columnas: {missing}")

    rows_to_insert = []
    for excel_row_index, row in df.iterrows():
        mm = map_df[map_df["excel_row_index"] == excel_row_index]
        if mm.empty: continue
        pasillo = str(mm.iloc[0]["pasillo"])
        lado    = str(mm.iloc[0]["lado"])
        est     = int(mm.iloc[0]["estanteria"])

        for anaquel_idx, col in enumerate(ana_cols, start=1):
            start, end, raw = parse_range(row.get(col, ""))
            if start is None: continue
            rows_to_insert.append((
                excel_row_index, pasillo, lado, est, anaquel_idx, start, end, str(raw)
            ))

    with sqlite3.connect(DB) as conn:
        c = conn.cursor()
        c.execute("DELETE FROM locations")
        c.executemany("""
            INSERT INTO locations (excel_row, pasillo, lado, estanteria, anaquel, rango_inicio, rango_fin, raw_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, rows_to_insert)
        conn.commit()

    print(f"DB creada: {DB} | filas insertadas: {len(rows_to_insert)}")

if __name__ == "__main__":
    load_and_parse()
