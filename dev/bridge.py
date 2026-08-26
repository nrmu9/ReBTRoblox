"""Local eval bridge for the BTRoblox DEV build. Stdlib only."""

import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 8787

JOB_TIMEOUT = 30.0
POLL_TIMEOUT = 25.0
LOG_LIMIT = 1000

jobs = queue.Queue()
results = {}
results_lock = threading.Lock()

logs = []
logs_lock = threading.Lock()

state = {"next_id": 1, "last_seen": 0.0}
state_lock = threading.Lock()


def next_id():
    with state_lock:
        job_id = state["next_id"]
        state["next_id"] += 1
        return job_id


def touch():
    with state_lock:
        state["last_seen"] = time.time()


def connected():
    with state_lock:
        last = state["last_seen"]
    return last > 0 and time.time() - last < POLL_TIMEOUT + 10


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode("utf8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length).decode("utf8") if length else ""

    def do_GET(self):
        url = urlparse(self.path)
        args = parse_qs(url.query)

        if url.path == "/poll":
            touch()
            try:
                return self.reply(200, jobs.get(timeout=POLL_TIMEOUT))
            except queue.Empty:
                return self.reply(200, {"idle": True})

        if url.path == "/logs":
            with logs_lock:
                out = list(logs)
                if args.get("clear"):
                    logs.clear()

            level = args.get("level", [None])[0]
            match = args.get("match", [None])[0]

            if level:
                out = [e for e in out if e.get("level") == level]
            if match:
                out = [e for e in out if match in json.dumps(e)]

            return self.reply(200, out[-int(args.get("n", ["50"])[0]):])

        if url.path == "/status":
            return self.reply(200, {
                "connected": connected(),
                "queued": jobs.qsize(),
                "logs": len(logs),
            })

        self.reply(404, {"error": "unknown route"})

    def do_POST(self):
        url = urlparse(self.path)
        args = parse_qs(url.query)
        body = self.body()

        if url.path == "/eval":
            job_id = next_id()
            done = threading.Event()

            with results_lock:
                results[job_id] = {"event": done, "value": None}

            jobs.put({
                "id": job_id,
                "target": args.get("target", ["tab"])[0],
                "code": body,
            })

            if not done.wait(JOB_TIMEOUT):
                with results_lock:
                    results.pop(job_id, None)
                reason = "timed out" if connected() else "extension not connected"
                return self.reply(504, {"ok": False, "error": reason})

            with results_lock:
                slot = results.pop(job_id, None)

            return self.reply(200, slot["value"])

        if url.path == "/result":
            touch()
            try:
                msg = json.loads(body)
            except ValueError:
                return self.reply(400, {"error": "bad json"})

            with results_lock:
                slot = results.get(msg.get("id"))
                if slot:
                    slot["value"] = msg
                    slot["event"].set()

            return self.reply(200, {"ok": True})

        if url.path == "/log":
            touch()
            try:
                entry = json.loads(body)
            except ValueError:
                return self.reply(400, {"error": "bad json"})

            entry["at"] = time.strftime("%H:%M:%S")

            with logs_lock:
                logs.append(entry)
                del logs[:-LOG_LIMIT]

            return self.reply(200, {"ok": True})

        self.reply(404, {"error": "unknown route"})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"btr bridge on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
