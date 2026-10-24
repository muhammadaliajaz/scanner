import os
import io
import csv
import uuid
import json
import tempfile
import threading
from datetime import datetime

import base64

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from qrcode.image.svg import SvgImage
from PIL import Image
import cv2

try:
    from pyzbar import pyzbar
    PYZBAR_AVAILABLE = True
except (ImportError, FileNotFoundError, OSError):
    PYZBAR_AVAILABLE = False

import barcode
from barcode.writer import ImageWriter
from openpyxl import Workbook
import numpy as np

app = Flask(__name__)

HISTORY_FILE = os.path.join(tempfile.gettempdir(), "qr_barcode_history.json")
GENERATED_DIR = os.path.join(tempfile.gettempdir(), "qr_barcode_generated")
os.makedirs(GENERATED_DIR, exist_ok=True)

AUTO_DELETE_SECONDS = 300


def _delete_later(path, delay=AUTO_DELETE_SECONDS):
    def _remove():
        try:
            if os.path.exists(path):
                os.unlink(path)
        except OSError:
            pass
    t = threading.Timer(delay, _remove)
    t.daemon = True
    t.start()


def _load_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []
    return []


def _save_history(history):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def _add_history(action, code_type, data, format_name=""):
    history = _load_history()
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "code_type": code_type,
        "data": data,
        "format": format_name,
    }
    history.insert(0, entry)
    if len(history) > 100:
        history = history[:100]
    _save_history(history)
    return entry


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    return jsonify({"pyzbar_available": PYZBAR_AVAILABLE})


# ── QR Code Generator ─────────────────────────────────────────────────────────

@app.route("/api/generate/qr", methods=["POST"])
def generate_qr():
    data = request.json or request.form
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "No text provided"}), 400

    size = int(data.get("size", 300))
    fill_color = data.get("fill_color", "#000000")
    back_color = data.get("back_color", "#FFFFFF")
    error_correction = data.get("error_correction", "M")
    logo_url = data.get("logo", "")

    ec_map = {"L": qrcode.constants.ERROR_CORRECT_L, "M": qrcode.constants.ERROR_CORRECT_M,
              "Q": qrcode.constants.ERROR_CORRECT_Q, "H": qrcode.constants.ERROR_CORRECT_H}
    ec = ec_map.get(error_correction, qrcode.constants.ERROR_CORRECT_M)

    qr = qrcode.QRCode(version=None, error_correction=ec, box_size=10, border=4)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color=fill_color, back_color=back_color)

    if logo_url:
        try:
            if logo_url.startswith("data:"):
                # Data URL: data:image/png;base64,...
                header, b64 = logo_url.split(",", 1)
                logo_bytes = base64.b64decode(b64)
                logo = Image.open(io.BytesIO(logo_bytes))
            else:
                logo = Image.open(logo_url)
            logo_size = size // 4
            logo = logo.resize((logo_size, logo_size), Image.LANCZOS)
            pos = ((img.size[0] - logo_size) // 2, (img.size[1] - logo_size) // 2)
            img.paste(logo, pos, logo if logo.mode == "RGBA" else None)
        except Exception:
            pass

    img = img.resize((size, size), Image.LANCZOS)

    fid = uuid.uuid4().hex
    png_path = os.path.join(GENERATED_DIR, f"{fid}.png")
    svg_path = os.path.join(GENERATED_DIR, f"{fid}.svg")
    jpg_path = os.path.join(GENERATED_DIR, f"{fid}.jpg")

    img.save(png_path, "PNG")
    img.convert("RGB").save(jpg_path, "JPEG", quality=95)

    qr_svg = qrcode.QRCode(version=None, error_correction=ec, box_size=10, border=4)
    qr_svg.add_data(text)
    qr_svg.make(fit=True)
    svg_img = qr_svg.make_image(fill_color=fill_color, back_color=back_color, image_factory=SvgImage)
    with open(svg_path, "wb") as f:
        svg_img.save(f)

    for p in (png_path, jpg_path, svg_path):
        _delete_later(p)

    entry = _add_history("generate", "QR Code", text)

    return jsonify({
        "id": fid,
        "files": {"png": f"/api/download/{fid}.png", "jpg": f"/api/download/{fid}.jpg", "svg": f"/api/download/{fid}.svg"},
        "history_id": entry["id"],
    })


# ── Barcode Generator ─────────────────────────────────────────────────────────

@app.route("/api/generate/barcode", methods=["POST"])
def generate_barcode():
    data = request.json or request.form
    text = data.get("text", "")
    fmt = data.get("format", "code128")
    if not text:
        return jsonify({"error": "No text provided"}), 400

    barcode_map = {
        "ean13": barcode.get_barcode_class("ean13"),
        "ean8": barcode.get_barcode_class("ean8"),
        "upca": barcode.get_barcode_class("upca"),
        "upce": barcode.get_barcode_class("upce"),
        "code128": barcode.get_barcode_class("code128"),
        "code39": barcode.get_barcode_class("code39"),
        "itf": barcode.get_barcode_class("itf"),
        "codabar": barcode.get_barcode_class("codabar"),
    }

    if fmt not in barcode_map:
        return jsonify({"error": f"Unsupported format: {fmt}"}), 400

    try:
        bc = barcode_map[fmt](text, writer=ImageWriter())
    except (barcode.errors.BarcodeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    fid = uuid.uuid4().hex
    png_path = os.path.join(GENERATED_DIR, f"{fid}.png")
    svg_path = os.path.join(GENERATED_DIR, f"{fid}.svg")
    jpg_path = os.path.join(GENERATED_DIR, f"{fid}.jpg")

    bc.save(png_path.replace(".png", ""))
    img = Image.open(png_path)
    img.convert("RGB").save(jpg_path, "JPEG", quality=95)

    bc_svg = barcode_map[fmt](text)
    with open(svg_path, "wb") as f:
        bc_svg.write(f)

    for p in (png_path, jpg_path, svg_path):
        _delete_later(p)

    entry = _add_history("generate", fmt.upper(), text, fmt)

    return jsonify({
        "id": fid,
        "files": {"png": f"/api/download/{fid}.png", "jpg": f"/api/download/{fid}.jpg", "svg": f"/api/download/{fid}.svg"},
        "history_id": entry["id"],
    })


# ── QR / Barcode Scanner ──────────────────────────────────────────────────────

@app.route("/api/scan", methods=["POST"])
def scan_image():
    if not PYZBAR_AVAILABLE:
        return jsonify({"error": "Server-side scanning unavailable. Please use the camera/live scan option instead.", "use_client": True}), 503

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty file"}), 400

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(f.filename)[1] or ".png")
    f.save(tmp.name)
    tmp.close()

    try:
        img = cv2.imread(tmp.name)
        if img is None:
            pil_img = Image.open(tmp.name).convert("RGB")
            img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

        decoded = pyzbar.decode(img)
        results = []
        for d in decoded:
            results.append({
                "data": d.data.decode("utf-8", errors="replace"),
                "type": d.type,
                "rect": {"x": int(d.rect.left), "y": int(d.rect.top), "w": int(d.rect.width), "h": int(d.rect.height)},
            })
            _add_history("scan", d.type, d.data.decode("utf-8", errors="replace"), d.type)

        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


# ── Batch Scan ────────────────────────────────────────────────────────────────

@app.route("/api/scan/batch", methods=["POST"])
def scan_batch():
    if not PYZBAR_AVAILABLE:
        return jsonify({"error": "Server-side scanning unavailable.", "use_client": True}), 503

    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    all_results = []
    for f in files:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(f.filename)[1] or ".png")
        f.save(tmp.name)
        tmp.close()
        try:
            img = cv2.imread(tmp.name)
            if img is None:
                pil_img = Image.open(tmp.name).convert("RGB")
                img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            decoded = pyzbar.decode(img)
            file_results = []
            for d in decoded:
                file_results.append({
                    "data": d.data.decode("utf-8", errors="replace"),
                    "type": d.type,
                })
                _add_history("scan", d.type, d.data.decode("utf-8", errors="replace"), d.type)
            all_results.append({"filename": f.filename, "results": file_results})
        except Exception as e:
            all_results.append({"filename": f.filename, "error": str(e)})
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    return jsonify({"results": all_results})


# ── Batch Generate ────────────────────────────────────────────────────────────

@app.route("/api/generate/batch", methods=["POST"])
def generate_batch():
    data = request.json or request.form
    items = data.get("items", [])
    code_type = data.get("code_type", "qr")
    fmt = data.get("format", "code128")

    if not items:
        return jsonify({"error": "No items provided"}), 400

    results = []
    for item in items:
        text = item.get("text", "")
        if not text:
            results.append({"text": "", "error": "Empty text"})
            continue

        fid = uuid.uuid4().hex
        try:
            if code_type == "qr":
                qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
                qr.add_data(text)
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")
                png_path = os.path.join(GENERATED_DIR, f"{fid}.png")
                img.save(png_path, "PNG")
                _delete_later(png_path)
                results.append({"text": text, "id": fid, "download": f"/api/download/{fid}.png"})
            else:
                barcode_map = {
                    "ean13": barcode.get_barcode_class("ean13"),
                    "ean8": barcode.get_barcode_class("ean8"),
                    "upca": barcode.get_barcode_class("upca"),
                    "code128": barcode.get_barcode_class("code128"),
                    "code39": barcode.get_barcode_class("code39"),
                }
                if fmt not in barcode_map:
                    results.append({"text": text, "error": f"Unsupported format: {fmt}"})
                    continue
                bc = barcode_map[fmt](text, writer=ImageWriter())
                png_path = os.path.join(GENERATED_DIR, f"{fid}.png")
                bc.save(png_path.replace(".png", ""))
                _delete_later(png_path)
                results.append({"text": text, "id": fid, "download": f"/api/download/{fid}.png"})

            _add_history("generate", code_type.upper(), text, fmt if code_type != "qr" else "")
        except Exception as e:
            results.append({"text": text, "error": str(e)})

    return jsonify({"results": results})


# ── Download ──────────────────────────────────────────────────────────────────

@app.route("/api/download/<filename>")
def download_file(filename):
    path = os.path.join(GENERATED_DIR, filename)
    if not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404
    ext = os.path.splitext(filename)[1].lower()
    mime = {"png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml"}.get(ext, "application/octet-stream")
    return send_file(path, mimetype=mime, as_attachment=True, download_name=filename)


# ── History ───────────────────────────────────────────────────────────────────

@app.route("/api/history")
def get_history():
    history = _load_history()
    limit = request.args.get("limit", 50, type=int)
    return jsonify({"history": history[:limit]})


@app.route("/api/history/clear", methods=["POST"])
def clear_history():
    _save_history([])
    return jsonify({"success": True})


# ── Export CSV / Excel ────────────────────────────────────────────────────────

@app.route("/api/export/csv")
def export_csv():
    history = _load_history()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Timestamp", "Action", "Code Type", "Data", "Format"])
    for h in history:
        writer.writerow([h.get("timestamp", ""), h.get("action", ""), h.get("code_type", ""), h.get("data", ""), h.get("format", "")])
    buf.seek(0)
    return send_file(io.BytesIO(buf.getvalue().encode("utf-8")), mimetype="text/csv", as_attachment=True, download_name="scan_history.csv")


@app.route("/api/export/excel")
def export_excel():
    history = _load_history()
    wb = Workbook()
    ws = wb.active
    ws.title = "Scan History"
    ws.append(["Timestamp", "Action", "Code Type", "Data", "Format"])
    for h in history:
        ws.append([h.get("timestamp", ""), h.get("action", ""), h.get("code_type", ""), h.get("data", ""), h.get("format", "")])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     as_attachment=True, download_name="scan_history.xlsx")


# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
