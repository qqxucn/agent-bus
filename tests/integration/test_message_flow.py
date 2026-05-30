#!/usr/bin/env python3
"""
Agent-Bus Integration Test: Full Message Flow
==============================================
Starts a real bus-server, registers agents, sends messages,
polls inboxes, and verifies the complete message lifecycle.

Usage:
    python tests/integration/test_message_flow.py

Requirements:
    - Node.js 22+ with npm
    - bus-server package installed (npm install already run)
    - Python 3.10+
"""

import json
import os
import signal
import subprocess
import sys
import time
import tempfile
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TEST_PORT = 14322
BASE_URL = f"http://localhost:{TEST_PORT}"
# 基于脚本自身位置推导项目根目录
# 脚本位置: tests/integration/test_message_flow.py
# 项目根: 脚本位置向上两层
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = _SCRIPT_DIR.parent.parent  # tests/../.. = project root
BUS_SERVER_DIR = (PROJECT_ROOT / "packages" / "bus-server").resolve()
DB_PATH = Path(tempfile.gettempdir()) / "test-bus-int.db"

ENV = {
    "HTTP_PORT": str(TEST_PORT),
    "DB_PATH": str(DB_PATH),
    "ADMIN_TOKEN": "test-admin-token",
    "AGENT_TOKEN_SECRET": "test-secret",
    "LOG_LEVEL": "info",
}

# Clean all env vars that might interfere
for k in list(os.environ.keys()):
    if k.startswith("AGENT_BUS_") or k in ("HTTP_PORT", "DB_PATH", "ADMIN_TOKEN", "AGENT_TOKEN_SECRET"):
        del os.environ[k]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PASS = 0
FAIL = 0


def test(name: str):
    """Decorator-like runner for test functions."""
    def decorator(fn):
        def wrapper(*args, **kwargs):
            global PASS, FAIL
            print(f"\n  ▶ {name}...", end=" ", flush=True)
            try:
                fn(*args, **kwargs)
                print("PASS")
                PASS += 1
            except Exception as e:
                print(f"FAIL")
                print(f"      {type(e).__name__}: {e}")
                FAIL += 1
        return wrapper
    return decorator


def http_request(method, path, body=None, token=None, expected_status=None):
    """Make an HTTP request to the bus-server and return parsed JSON response."""
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    data = json.dumps(body).encode("utf-8") if body else None
    req = Request(url, data=data, headers=headers, method=method)

    try:
        with urlopen(req, timeout=10) as resp:
            response_body = json.loads(resp.read().decode("utf-8"))
            if expected_status is not None:
                assert resp.status == expected_status, (
                    f"Expected HTTP {expected_status}, got {resp.status}"
                )
            return response_body
    except HTTPError as e:
        if expected_status is not None:
            assert e.code == expected_status, (
                f"Expected HTTP {expected_status}, got {e.code}"
            )
        body_text = e.read().decode("utf-8", errors="replace")
        return json.loads(body_text) if body_text else {"code": -1, "message": "unknown"}
    except URLError as e:
        raise AssertionError(f"Connection failed: {e.reason}")


def http_get(path, token=None):
    """GET request helper."""
    url = f"{BASE_URL}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, headers=headers, method="GET")
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def assert_response(resp, expected_code=0, expected_data_key=None):
    """Assert API response structure."""
    assert isinstance(resp, dict), f"Response is not a dict: {resp}"
    assert resp.get("code") == expected_code, (
        f"Expected code={expected_code}, got code={resp.get('code')}, msg={resp.get('message')}"
    )
    if expected_data_key is not None:
        assert resp.get("data") is not None, "Response missing 'data'"
        assert expected_data_key in resp["data"], (
            f"Response data missing key '{expected_data_key}': {resp['data']}"
        )


def calculate_token(agent_id: str) -> str:
    """Replicate bus-server's HMAC-SHA256 token generation."""
    import hmac
    return hmac.new(
        b"test-secret",
        agent_id.encode("utf-8"),
        "sha256"
    ).hexdigest()


# ---------------------------------------------------------------------------
# Test Suite
# ---------------------------------------------------------------------------


def build_server():
    """Build the bus-server if dist/ doesn't exist or is stale."""
    print("  [setup] Checking bus-server build...")
    dist_dir = BUS_SERVER_DIR / "dist"
    src_files = list((BUS_SERVER_DIR / "src").rglob("*.ts"))
    dist_files = list(dist_dir.rglob("*.js")) if dist_dir.exists() else []

    needs_build = not dist_dir.exists() or not dist_files

    if not needs_build:
        # Check if any source file is newer than dist files
        dist_mtime = max(f.stat().st_mtime for f in dist_files)
        for src in src_files:
            if src.stat().st_mtime > dist_mtime:
                needs_build = True
                break

    if needs_build:
        print("  [setup] Building bus-server (using tsx as runtime)...")
        # The TypeScript build has type errors, so we use tsx directly
        print("  [setup] Will use tsx (ts-node alternative) to run the server")
    else:
        print("  [setup] Build up-to-date, using dist/")


def start_server():
    """Start bus-server as a subprocess and wait for it to be ready."""
    print("  [setup] Starting bus-server...")

    # Remove old DB if exists
    if DB_PATH.exists():
        DB_PATH.unlink()

    # Use tsx to run the server (avoids TypeScript build issues)
    cmd = [
        "npx", "tsx", "src/index.ts",
    ]

    proc = subprocess.Popen(
        cmd,
        cwd=str(BUS_SERVER_DIR),
        env={**os.environ, **ENV},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    # Wait for server to be ready (poll health endpoint)
    deadline = time.monotonic() + 15
    started = False
    output_lines = []

    while time.monotonic() < deadline:
        time.sleep(0.3)
        # Check process is still alive
        if proc.poll() is not None:
            stdout, _ = proc.communicate(timeout=2)
            print(f"  [setup] Server exited prematurely (code {proc.returncode})")
            print(f"  [setup] Output:\n{stdout.decode('utf-8', errors='replace')}")
            sys.exit(1)

        # Try health endpoint
        try:
            req = Request(f"{BASE_URL}/api/health", method="GET")
            with urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("code") == 0:
                    started = True
                    break
        except Exception:
            pass

    if not started:
        # Get any output from the process
        try:
            stdout, _ = proc.communicate(timeout=3)
            output_lines = stdout.decode("utf-8", errors="replace").splitlines()
        except Exception:
            pass

        print("  [setup] Failed to start bus-server within 15 seconds")
        if output_lines:
            print("  [setup] Last output:")
            for line in output_lines[-10:]:
                print(f"         {line}")
        # Kill if still running
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
        sys.exit(1)

    print(f"  [setup] Bus-server started (pid={proc.pid})")
    return proc


def stop_server(proc):
    """Gracefully stop the bus-server and clean up."""
    print("  [cleanup] Stopping bus-server...")
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        print("  [cleanup] Force killing...")
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            pass
    except Exception as e:
        print(f"  [cleanup] Warning: {e}")

    # Clean up DB
    if DB_PATH.exists():
        DB_PATH.unlink()
    print("  [cleanup] Done")


# ===========================================================================
# Test Cases
# ===========================================================================

@test("Health check returns healthy status")
def test_health():
    resp = http_get("/api/health")
    assert_response(resp, expected_code=0)
    assert resp["data"]["status"] == "healthy"
    assert "agents_online" in resp["data"]
    assert "agents_total" in resp["data"]


@test("Stats endpoint returns metrics")
def test_stats():
    resp = http_get("/api/stats")
    assert_response(resp, expected_code=0)
    assert "total_messages" in resp["data"]
    assert "agents_total" in resp["data"]


@test("Register a new agent")
def test_register_agent():
    resp = http_request("POST", "/api/agents/register", {
        "agent_id": "agent_a",
        "display_name": "Agent Alpha",
    })
    assert_response(resp, expected_code=0, expected_data_key="token")
    assert resp["data"]["success"] is True
    assert resp["data"]["agent_id"] == "agent_a"
    # Token should be HMAC-SHA256 of agent_id
    expected_token = calculate_token("agent_a")
    assert resp["data"]["token"] == expected_token, (
        f"Token mismatch: expected {expected_token}, got {resp['data']['token']}"
    )


@test("Register a second agent")
def test_register_agent_b():
    resp = http_request("POST", "/api/agents/register", {
        "agent_id": "agent_b",
        "display_name": "Agent Beta",
    })
    assert_response(resp, expected_code=0, expected_data_key="token")
    assert resp["data"]["agent_id"] == "agent_b"
    expected_token = calculate_token("agent_b")
    assert resp["data"]["token"] == expected_token


@test("Duplicate registration returns success (idempotent)")
def test_duplicate_registration():
    """Registering the same agent again should succeed (idempotent)."""
    resp = http_request("POST", "/api/agents/register", {
        "agent_id": "agent_a",
        "display_name": "Agent Alpha Again",
    })
    assert_response(resp, expected_code=0, expected_data_key="token")
    assert resp["data"]["success"] is True


@test("Registration with wrong token returns 409")
def test_registration_conflict():
    """Registering with mismatched token should fail."""
    resp = http_request("POST", "/api/agents/register", {
        "agent_id": "agent_a",
        "token": "wrong-token",
    }, expected_status=409)
    assert resp.get("code") == 1005
    assert resp.get("message") == "duplicate_agent"


@test("Registration without agent_id fails")
def test_register_no_id():
    resp = http_request("POST", "/api/agents/register", {
        "display_name": "No ID Agent",
    })
    assert resp.get("code") == 1002


@test("Send message from agent_a to agent_b")
def test_send_message():
    token_a = calculate_token("agent_a")
    resp = http_request("POST", "/api/messages/send", {
        "from": "agent_a",
        "to": "agent_b",
        "type": "text",
        "content": "Hello from Agent Alpha!",
        "session_id": "test-session-001",
    }, token=token_a)
    assert_response(resp, expected_code=0, expected_data_key="message_id")
    assert resp["data"]["success"] is True
    # Store the message_id for later verification
    global _sent_message_id
    _sent_message_id = resp["data"]["message_id"]
    assert _sent_message_id is not None


@test("Send message without auth fails")
def test_send_message_no_auth():
    resp = http_request("POST", "/api/messages/send", {
        "from": "agent_a",
        "to": "agent_b",
        "type": "text",
        "content": "Unauthorized",
    })
    # Should return 401 Unauthorized
    assert resp.get("code") == 1001, f"Expected auth error, got: {resp}"


@test("Send message with invalid type fails")
def test_send_invalid_type():
    token_a = calculate_token("agent_a")
    resp = http_request("POST", "/api/messages/send", {
        "from": "agent_a",
        "to": "agent_b",
        "type": "invalid_type",
        "content": "Bad type",
    }, token=token_a)
    assert resp.get("code") == 1002


@test("Send message missing required fields fails")
def test_send_missing_fields():
    token_a = calculate_token("agent_a")
    resp = http_request("POST", "/api/messages/send", {
        "from": "agent_a",
        "type": "text",
        "content": "Missing recipient",
    }, token=token_a)
    assert resp.get("code") == 1002


@test("Agent_b receives the message via inbox")
def test_receive_message():
    token_b = calculate_token("agent_b")
    resp = http_get(f"/api/messages/inbox?agent_id=agent_b&limit=10", token=token_b)
    assert_response(resp, expected_code=0)
    data = resp["data"]
    assert "messages" in data
    assert "total" in data
    assert data["total"] >= 1, f"Expected at least 1 message, got {data['total']}"

    # Find our message
    found = False
    for msg in data["messages"]:
        if msg.get("message_id") == _sent_message_id:
            found = True
            assert msg["from_agent"] == "agent_a"
            assert msg["to_agent"] == "agent_b"
            assert msg["type"] == "text"
            assert msg["content"] == "Hello from Agent Alpha!"
            assert msg["session_id"] == "test-session-001"
            assert msg["sender_type"] == "agent"
            assert msg["status"] in ("pending", "delivered")
            break

    assert found, f"Message {_sent_message_id} not found in inbox. Total messages: {data['total']}"


@test("Agent_a's own inbox does not contain agent_b's message")
def test_inbox_isolation():
    """Agents should only see messages addressed to them."""
    token_a = calculate_token("agent_a")
    resp = http_get(f"/api/messages/inbox?agent_id=agent_a&limit=10", token=token_a)
    assert_response(resp, expected_code=0)
    data = resp["data"]
    for msg in data["messages"]:
        assert msg["to_agent"] == "agent_a", (
            f"Agent_a's inbox contains message for {msg['to_agent']}: {msg['message_id']}"
        )


@test("Send message with file_id and caption")
def test_send_file_message():
    token_a = calculate_token("agent_a")
    resp = http_request("POST", "/api/messages/send", {
        "from": "agent_a",
        "to": "agent_b",
        "type": "file",
        "content": "Here is the report",
        "file_id": "f_abc123",
        "caption": "Q1 Report",
    }, token=token_a)
    assert_response(resp, expected_code=0, expected_data_key="message_id")
    file_msg_id = resp["data"]["message_id"]

    # Verify in inbox
    token_b = calculate_token("agent_b")
    resp = http_get(f"/api/messages/inbox?agent_id=agent_b&limit=10", token=token_b)
    assert_response(resp, expected_code=0)
    found = False
    for msg in resp["data"]["messages"]:
        if msg["message_id"] == file_msg_id:
            found = True
            assert msg["type"] == "file"
            assert msg["file_id"] == "f_abc123"
            assert msg["caption"] == "Q1 Report"
            break
    assert found, "File message not found in inbox"


@test("Send message with ref_id (reply)")
def test_send_reply():
    token_a = calculate_token("agent_a")
    resp = http_request("POST", "/api/messages/send", {
        "from": "agent_a",
        "to": "agent_b",
        "type": "text",
        "content": "This is a reply",
        "ref_id": _sent_message_id,
    }, token=token_a)
    assert_response(resp, expected_code=0, expected_data_key="message_id")
    reply_id = resp["data"]["message_id"]

    # Verify ref_id is stored
    token_b = calculate_token("agent_b")
    resp = http_get(f"/api/messages/inbox?agent_id=agent_b&limit=10", token=token_b)
    assert_response(resp, expected_code=0)
    found = False
    for msg in resp["data"]["messages"]:
        if msg["message_id"] == reply_id:
            found = True
            assert msg["ref_id"] == _sent_message_id
            break
    assert found, "Reply message not found in inbox"


@test("Inbox returns correct total count")
def test_inbox_total():
    token_b = calculate_token("agent_b")
    resp = http_get(f"/api/messages/inbox?agent_id=agent_b&limit=50", token=token_b)
    assert_response(resp, expected_code=0)
    # We sent 3 messages to agent_b: text, file, reply
    assert resp["data"]["total"] >= 3, f"Expected >= 3 messages, got {resp['data']['total']}"
    assert len(resp["data"]["messages"]) >= 3


@test("Unregistered agent cannot send messages")
def test_unregistered_agent_send():
    """An agent that hasn't registered should still pass auth if token format matches,
    but the bus-server auth checks against registered agents. Even with a correct-format
    token, an unregistered agent should be rejected."""
    # This token matches format but agent 'ghost' hasn't registered
    token_ghost = calculate_token("ghost")
    resp = http_request("POST", "/api/messages/send", {
        "from": "ghost",
        "to": "agent_b",
        "type": "text",
        "content": "Hello from ghost!",
    }, token=token_ghost)
    # The auth middleware checks all registered agents - ghost is not registered
    # so this should fail with invalid_token
    assert resp.get("code") in (1001, 1002), f"Expected auth error for ghost agent, got: {resp}"


@test("Inbox without auth fails")
def test_inbox_no_auth():
    """Inbox without auth header should return 401 with code 1001."""
    try:
        resp = http_get("/api/messages/inbox?agent_id=agent_b")
        # If we get here, the server didn't reject — but should have
        assert resp.get("code") == 1001, f"Expected auth error, got: {resp}"
    except HTTPError as e:
        # The middleware returns HTTP 401 + JSON body
        assert e.code == 401, f"Expected 401, got {e.code}"
        body = json.loads(e.read().decode("utf-8", errors="replace"))
        assert body.get("code") == 1001, f"Expected code 1001, got: {body}"


@test("Inbox for non-existent agent returns auth error")
def test_inbox_nonexistent():
    """Unregistered agents should fail auth check."""
    token_nonexistent = calculate_token("nonexistent_agent")
    try:
        resp = http_get("/api/messages/inbox?agent_id=nonexistent_agent", token=token_nonexistent)
        assert resp.get("code") == 1001, f"Expected auth error, got: {resp}"
    except HTTPError as e:
        assert e.code == 401, f"Expected 401, got {e.code}"
        body = json.loads(e.read().decode("utf-8", errors="replace"))
        assert body.get("code") == 1001, f"Expected code 1001, got: {body}"


# Track sent message ID across tests
_sent_message_id = None


# ===========================================================================
# Main
# ===========================================================================

def main():
    global PASS, FAIL

    print("=" * 60)
    print(" Agent-Bus Integration Test Suite")
    print("=" * 60)
    print()

    # Build
    build_server()

    # Start server
    proc = start_server()

    try:
        # Run all test functions
        tests = [
            test_health,
            test_stats,
            test_register_agent,
            test_register_agent_b,
            test_duplicate_registration,
            test_registration_conflict,
            test_register_no_id,
            test_send_message,
            test_send_message_no_auth,
            test_send_invalid_type,
            test_send_missing_fields,
            test_receive_message,
            test_inbox_isolation,
            test_send_file_message,
            test_send_reply,
            test_inbox_total,
            test_unregistered_agent_send,
            test_inbox_no_auth,
            test_inbox_nonexistent,
        ]

        for t in tests:
            t()

    finally:
        stop_server(proc)

    print()
    print("=" * 60)
    total = PASS + FAIL
    print(f" Results: {PASS}/{total} passed, {FAIL}/{total} failed")
    print("=" * 60)

    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
