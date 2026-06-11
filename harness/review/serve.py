#!/usr/bin/env -S uv run python
"""Serve the eval review interface (harness/review/app) locally.

Endpoints:
  GET  /                -> app/index.html
  GET  /api/traces      -> the traces.json built by extract_traces.py
  GET  /api/labels      -> all saved labels
  POST /api/labels      -> upsert one label: {"trace_id", "label"?, "notes"?}

Labels persist to a JSON file (atomic replace on every write — the app
auto-saves on every action). Local-only tool: binds 127.0.0.1, no auth,
stdlib only.

Usage:
  uv run harness/review/extract_traces.py --demo
  uv run harness/review/serve.py            # http://127.0.0.1:8765
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import tempfile
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_DIR = Path(__file__).resolve().parent / "app"
VALID_LABELS = ("pass", "fail", "defer")


def load_labels(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_labels(path: Path, labels: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".labels-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(labels, handle, indent=1, ensure_ascii=False)
        handle.write("\n")
    os.replace(tmp, path)


def make_handler(traces_path: Path, labels_path: Path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(APP_DIR), **kwargs)

        def log_message(self, fmt, *args):  # quiet
            pass

        def _json(self, code: int, payload: object) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.split("?")[0] == "/api/version":
                # Data hot-reload: the app polls this and re-fetches when an
                # mtime moves (new extract_traces.py run, another reviewer).
                def mtime(path: Path) -> float | None:
                    try:
                        return path.stat().st_mtime
                    except OSError:
                        return None
                return self._json(200, {"traces": mtime(traces_path), "labels": mtime(labels_path)})
            if self.path.split("?")[0] == "/api/traces":
                if not traces_path.is_file():
                    return self._json(404, {"error": f"{traces_path} not found; run extract_traces.py first"})
                return self._json(200, json.loads(traces_path.read_text(encoding="utf-8")))
            if self.path.split("?")[0] == "/api/labels":
                return self._json(200, load_labels(labels_path))
            return super().do_GET()

        def do_POST(self):
            if self.path.split("?")[0] != "/api/labels":
                return self._json(404, {"error": "unknown endpoint"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                update = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "invalid JSON body"})
            trace_id = update.get("trace_id")
            if not isinstance(trace_id, str) or not trace_id:
                return self._json(400, {"error": "trace_id required"})
            label = update.get("label")
            if label is not None and label not in VALID_LABELS:
                return self._json(400, {"error": f"label must be one of {VALID_LABELS} or null"})

            labels = load_labels(labels_path)
            entry = labels.get(trace_id, {})
            if "label" in update:
                entry["label"] = label
            if "notes" in update:
                entry["notes"] = str(update["notes"])
            entry["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            entry["reviewer"] = getpass.getuser()
            if not entry.get("label") and not entry.get("notes"):
                labels.pop(trace_id, None)  # cleared label + empty notes = unlabeled
            else:
                labels[trace_id] = entry
            save_labels(labels_path, labels)
            return self._json(200, {"ok": True, "trace_id": trace_id, "entry": labels.get(trace_id)})

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--traces", type=Path, default=REPO_ROOT / "runs" / "review" / "traces.json")
    parser.add_argument("--labels", type=Path, default=REPO_ROOT / "runs" / "review" / "labels.json")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.traces, args.labels))
    print(f"review interface: http://127.0.0.1:{args.port}")
    print(f"  traces: {args.traces}")
    print(f"  labels: {args.labels}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
