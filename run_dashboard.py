#!/usr/bin/env python3
"""
LiveSense AI - Dashboard Runner
Launches the FastAPI server and opens Google Chrome automatically.
"""
import os
import sys
import subprocess
import time
import webbrowser

# Add web_app directory to path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

import uvicorn
from web_app.server import app

def open_chrome(url="http://localhost:8000"):
    time.sleep(1.2)
    print(f"Opening Google Chrome at {url}...")
    try:
        subprocess.Popen(["open", "-a", "Google Chrome", url])
    except Exception:
        webbrowser.open(url)

if __name__ == "__main__":
    import threading
    threading.Thread(target=open_chrome, daemon=True).start()
    print("🚀 Starting LiveSense AI Edge-AI Dashboard on http://localhost:8000 ...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
