"""Read-only project metadata access; MySQL after cutover, SQLite for old fixtures.

Node owns the encrypted connection configuration. No password reaches Python or argv.
The bridge is persistent for the lifetime of the inventory/quality job.
"""
import json
import sqlite3
import subprocess
import threading
from pathlib import Path
from urllib.parse import urlparse, unquote

class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)

class Cursor:
    def __init__(self, rows): self.rows = [Row(row) for row in rows]
    def fetchall(self): result = self.rows; self.rows = []; return result
    def fetchone(self): return self.rows.pop(0) if self.rows else None

class Connection:
    row_factory = None
    def __init__(self, path):
        self.process = subprocess.Popen(['node', str(Path(__file__).with_name('database-read.mjs')), str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    def execute(self, sql, params=()):
        if not sql.lstrip().upper().startswith('SELECT ') or ';' in sql: raise ValueError('Read-only query required')
        timer = threading.Timer(20, self.process.kill); timer.start()
        try:
            self.process.stdin.write(json.dumps({'sql': sql, 'params': list(params)}, ensure_ascii=False)+'\n'); self.process.stdin.flush()
            line = self.process.stdout.readline()
            if not line: raise RuntimeError('Project database unavailable; no SQLite fallback after MySQL cutover')
            result = json.loads(line)
            if 'error' in result: raise RuntimeError(result['error'])
            return Cursor(result['rows'])
        finally: timer.cancel()
    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired: self.process.kill(); self.process.wait()
        self.process.stdout.close()

def connect(database, **kwargs):
    parsed = urlparse(str(database))
    path = Path(unquote(parsed.path).lstrip('/') if parsed.scheme == 'file' and len(parsed.path)>2 and parsed.path[2]==':' else unquote(parsed.path) if parsed.scheme=='file' else database)
    config = path.parent/'secrets/mysql.json'
    if config.exists():
        if not kwargs.get('uri') or 'mode=ro' not in parsed.query: raise ValueError('Only read-only project jobs use this adapter')
        return Connection(path)
    if (path.parent/'mysql-active.json').exists(): raise RuntimeError('Missing MySQL configuration')
    return sqlite3.connect(database, **kwargs)
