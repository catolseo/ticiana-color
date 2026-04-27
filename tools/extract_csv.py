"""Extract Ticiana / Hongpu AdsPro formula book (CSV) into data.js + per-product formula files.

Source files:
  C:\\claude\\ticiana-color\\data\\book\\*.book.csv  — 172 unencrypted book files (Jan-2024 backup)
  C:\\claude\\ticiana-color\\data\\tint_book.ini    — product/fandeck mapping, can sizes,
                                                     base densities, colorant metadata.

Book CSV format (cp866 DOS Russian, CRLF):
  Header: <yymmddhhmm>;[Default];<file label>;;;;;[lt]<size>;1;1
  Record: <yymmdd>;<code>;;;<color_int>;<base>;[CID]amount[CID]amount...;;1;1
tint_book.ini: UTF-8 with BOM.

DropSize = 1.0 mL  (one colorant unit = 1 mL; values in the formula are mL directly).

Output:
  C:\\claude\\ticiana-color\\data.js                  — core (colorants, bases, cans, products)
  C:\\claude\\ticiana-color\\formulas\\p<i>.js        — formulas for one product line, lazy-load
"""

import json
import math
import os
import re
import configparser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BOOK_DIR = os.path.join(ROOT, "data", "book")
TINT_INI = os.path.join(ROOT, "data", "tint_book.ini")
OUT_DIR = ROOT
ML_PER_L = 1000


def parse_pairs(s, pat=re.compile(r"\[([^\]]+)\]([0-9.]*)")):
    """Parse `[A]1.0[B]2.5` style strings into dict {A: 1.0, B: 2.5}. Numeric only."""
    out = {}
    for k, v in pat.findall(s or ""):
        if v == "":
            continue
        try:
            out[k] = float(v)
        except ValueError:
            pass
    return out


def parse_str_pairs(s):
    """`[A]Белая[A1]Декоративная[C]...` → {A: "Белая", A1: "Декоративная", ...}.

    Values are arbitrary text up to the next `[` or end of string.
    """
    out = {}
    pat = re.compile(r"\[([^\]]+)\]([^\[]*)")
    for k, v in pat.findall(s or ""):
        out[k] = v.strip()
    return out


def parse_unit_size(s):
    """`[LT]0.9/0.9/2.5` → ("LT", [0.9, 0.9, 2.5]); first item is the formula reference."""
    m = re.match(r"\[([A-Za-z]+)\]([0-9./]+)", s or "")
    if not m:
        return None, []
    return m.group(1).upper(), [float(x) for x in m.group(2).split("/") if x]


def srgb_to_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    c = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
    return round(max(0.0, min(1.0, c)) * 255)


def synthesize_rgb(formula_pairs, cnt_rgb, can_ml):
    """Subtractive (Beer-Lambert) preview of pigment mixing over a white base.

    Used when the database doesn't carry RGB (AdsPro stores an opaque <color_int>
    we couldn't decode). Each pigment absorbs per channel with coefficient
    (1 - hex_channel/255); absorptions add weighted by concentration; reflected
    light = exp(-absorption). STRENGTH compensates for absent K/S data —
    real pigments are far more potent at low concentration than naive
    volume-fraction mixing suggests, so without it most formulas would render
    as near-white.
    """
    if can_ml <= 0 or not formula_pairs:
        return [255, 255, 255]
    STRENGTH = 80.0
    absorb = [0.0, 0.0, 0.0]
    for cid, amt in formula_pairs.items():
        rgb = cnt_rgb.get(cid)
        if not rgb:
            continue
        conc = (amt / can_ml) * STRENGTH
        for i in range(3):
            absorb[i] += conc * (1.0 - rgb[i] / 255.0)
    return [round(max(0.0, min(1.0, math.exp(-a))) * 255) for a in absorb]


def hex_to_rgb(h):
    h = h.lstrip("#")
    return [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]


def read_ini():
    """Parse tint_book.ini. Sections "Product|Fandeck" map to a book CSV file plus per-product
    sizes (ProSize), base density (ProDens), colorant strength multiplier (ProMult).

    The [Default_INI] section carries the global colorant + base catalogs.
    """
    cp = configparser.ConfigParser(interpolation=None, strict=False)
    cp.optionxform = str
    with open(TINT_INI, "r", encoding="utf-8-sig") as f:
        cp.read_file(f)

    default = cp["Default_INI"]
    drop_ml = float(default.get("DropSize", "1.0"))
    load_date = default.get("LoadDate", "").strip()  # yymmdd, e.g. "231215"

    base_codes = [s.strip() for s in default["ProList"].split(",")]
    base_text = parse_str_pairs(default["ProText"])  # e.g. "A-Белая"
    bases = {}
    for code in base_codes:
        full = base_text.get(code, code)
        descr = full.split("-", 1)[1].strip() if "-" in full else full
        bases[code] = {"code": code, "descr": descr}

    dye_codes = [s.strip() for s in default["DyeList"].split(",")]
    dye_text = parse_str_pairs(default["DyeText"])    # "AN-H.P. YELLOW"
    dye_name = parse_str_pairs(default["DyeName"])    # "AN-H.P. Yellow" (mixed case)
    dye_dens = parse_pairs(default["DyeDens"])
    dye_html = parse_str_pairs(default["DyeHtml"])    # "FDFF13" hex string
    colorants = []
    for code in dye_codes:
        text = dye_name.get(code) or dye_text.get(code, code)
        descr = text.split("-", 1)[1].strip() if "-" in text else text
        hex_str = dye_html.get(code, "888888").lower()
        colorants.append({
            "id": code,
            "code": code,
            "descr": descr,
            "hex": "#" + hex_str,
            "density": dye_dens.get(code, 1.1),
        })

    # Per-product sections
    products = {}
    for sect in cp.sections():
        if sect == "Default_INI":
            continue
        if "|" not in sect:
            continue
        prod, fandeck = sect.split("|", 1)
        s = cp[sect]
        file_name = s.get("ProFile", "").strip()
        if not file_name:
            continue
        unit, sizes = parse_unit_size(s.get("ProSize", ""))
        dens = parse_pairs(s.get("ProDens", ""))
        mult = parse_pairs(s.get("ProMult", ""))
        products.setdefault(prod, []).append({
            "fandeck": fandeck,
            "file": file_name,
            "unit": unit,
            "sizes": sizes,
            "dens": dens,
            "mult": mult,
        })
    return drop_ml, load_date, bases, colorants, products


def read_book(path):
    """Yield (date, code, color_int_str, base_code, formula_str, flag1, flag2)."""
    with open(path, "rb") as f:
        text = f.read().decode("cp866", errors="replace")
    lines = text.strip().split("\r\n")
    if not lines:
        return None, []
    head = lines[0].split(";")
    title = head[2] if len(head) > 2 else ""
    rows = []
    for line in lines[1:]:
        p = line.split(";")
        if len(p) < 7 or not p[1]:
            continue
        rows.append({
            "date": p[0],
            "code": p[1],
            "color_int": p[4] if len(p) > 4 else "",
            "base": p[5] if len(p) > 5 else "",
            "formula": p[6] if len(p) > 6 else "",
        })
    return title, rows


def compact_formula(pairs):
    parts = []
    for cid, a in pairs.items():
        parts.append(f"{cid}:{a:g}")
    return ";".join(parts)


def write_js(path, var_assign, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"// Auto-generated from data/book + tint_book.ini by tools/extract_csv.py. Do not edit.\n")
        f.write(f"{var_assign} = ")
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


def main():
    drop_ml, load_date, bases, colorants, products = read_ini()
    cnt_rgb = {c["id"]: hex_to_rgb(c["hex"]) for c in colorants}

    # Build flat product catalog. We use a 1-based numeric ID per product line for
    # the formula file name (p1.js, p2.js, ...).
    product_catalog = []
    pid = 0
    total = 0
    no_rgb = 0
    os.makedirs(os.path.join(OUT_DIR, "formulas"), exist_ok=True)

    for prod_name in sorted(products.keys()):
        pid += 1
        rows = []
        fandecks_meta = []
        for sp_idx, sp in enumerate(products[prod_name]):
            fpath = os.path.join(BOOK_DIR, sp["file"])
            if not os.path.exists(fpath):
                continue
            title, book_rows = read_book(fpath)
            n = 0
            # Tuple layout below must stay in sync with F_* constants in app.js.
            for r in book_rows:
                pairs = parse_pairs(r["formula"])
                if not pairs:
                    continue
                ref_ml = (sp["sizes"][0] * ML_PER_L) if sp["sizes"] else 0.9 * ML_PER_L
                rgb = synthesize_rgb(pairs, cnt_rgb, ref_ml)
                rows.append([sp_idx, r["code"], r["base"], compact_formula(pairs), rgb])
                n += 1
            fandecks_meta.append({
                "id": sp_idx,
                "code": sp["fandeck"],
                "descr": sp["fandeck"],
                "n": n,
                "unit": sp["unit"],
                "sizes": sp["sizes"],
                "dens": sp["dens"],
                "mult": sp["mult"],
            })
            total += n
        if rows:
            product_catalog.append({
                "id": str(pid),
                "code": prod_name,
                "descr": prod_name,
                "subproducts": fandecks_meta,
            })
            out_path = os.path.join(OUT_DIR, "formulas", f"p{pid}.js")
            write_js(out_path, f"window.TICIANA_FORMULAS_P{pid}", rows)
            print(f"  p{pid}.js {prod_name[:40]:<40}: {len(rows):>5,} formulas, {os.path.getsize(out_path):>9,} B")
        else:
            pid -= 1

    out_bases = {code: {"code": b["code"], "descr": b["descr"]} for code, b in bases.items()}
    out_colorants = colorants
    # tint_book.ini stores LoadDate as yymmdd (e.g. "231215" → "15.12.2023").
    if len(load_date) == 6 and load_date.isdigit():
        version = f"AdsPro {load_date[4:6]}.{load_date[2:4]}.20{load_date[0:2]}"
    else:
        version = "AdsPro"
    version += f" · {len(product_catalog)} продуктов · {total:,} формул".replace(",", " ")
    core = {
        "version": version,
        "drop_ml": drop_ml,
        "colorants": out_colorants,
        "bases": out_bases,
        "products": product_catalog,
    }
    core_path = os.path.join(OUT_DIR, "data.js")
    write_js(core_path, "window.TICIANA_DATA", core)
    print(f"\ndata.js: {os.path.getsize(core_path):,} bytes, {len(product_catalog)} products")
    print(f"Total formulas: {total:,}")

    # Bump cache-bust query string in index.html so users get fresh data.js/app.js
    # without waiting for max-age=600 to expire on GitHub Pages CDN.
    index_path = os.path.join(OUT_DIR, "index.html")
    cache_bust = load_date or "0"
    html = open(index_path, encoding="utf-8").read()
    html = re.sub(r'<script src="data\.js(?:\?v=[^"]*)?"></script>',
                  f'<script src="data.js?v={cache_bust}"></script>', html)
    html = re.sub(r'<script src="app\.js(?:\?v=[^"]*)?"></script>',
                  f'<script src="app.js?v={cache_bust}"></script>', html)
    open(index_path, "w", encoding="utf-8", newline="").write(html)
    print(f"index.html cache-bust set to ?v={cache_bust}")


if __name__ == "__main__":
    main()
