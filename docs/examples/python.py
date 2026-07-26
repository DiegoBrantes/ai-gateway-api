"""AI Gateway API — Python examples (standard library only)."""
import json
import os
import urllib.request

BASE = os.environ.get("BASE", "http://localhost:3000")
KEY = os.environ.get("API_KEY", "dev-key-please-change")
HEADERS = {"content-type": "application/json", "x-api-key": KEY}


def chat(prompt: str) -> dict:
    body = json.dumps({"messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(f"{BASE}/v1/chat", data=body, headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def stream(prompt: str) -> None:
    """Consume the SSE stream (events: provider, delta, done, end)."""
    body = json.dumps({"messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(f"{BASE}/v1/chat/stream", data=body, headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        for raw in resp:
            line = raw.decode().rstrip("\n")
            if line.startswith("data: "):
                payload = line[6:]
                if payload != "[DONE]":
                    try:
                        chunk = json.loads(payload)
                        if "content" in chunk:
                            print(chunk["content"], end="", flush=True)
                    except json.JSONDecodeError:
                        pass


if __name__ == "__main__":
    result = chat("Explain a reverse proxy in one sentence.")
    print(result["content"], "· cost:", result["cost"]["totalCost"])
    stream("Write a haiku about the sea.")
    print()
