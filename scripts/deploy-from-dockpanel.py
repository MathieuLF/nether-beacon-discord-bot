#!/usr/bin/env python3
"""Deploy Nether Beacon from its owner-scoped DockPanel secret vault.

This helper is intended to be installed root-only on the VPS. It creates a
short-lived local DockPanel session in memory, pulls the vault, and passes the
values to Docker Compose through the child process environment. No plaintext
secret file is written.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


API_BASE = "http://127.0.0.1:3080/api"
API_ENV = Path("/etc/dockpanel/api.env")
CONTROL_DB_CONTAINER = "dockpanel-postgres"
DEFAULT_COMPOSE_FILE = Path("/srv/example/discord-bot/app/docker-compose.yml")
DEFAULT_VAULT = "nether-beacon-production"
CONTAINER_NAME = "nether-beacon"
REQUIRED_KEYS = {"DISCORD_GUILD_ID", "DISCORD_BOT_TOKEN", "MUSE_DISCORD_TOKEN"}
ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class DeploymentError(RuntimeError):
    pass


def load_env_value(path: Path, wanted: str) -> str:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != wanted:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if not value:
            raise DeploymentError(f"{wanted} is empty in {path}")
        return value
    raise DeploymentError(f"{wanted} is missing from {path}")


def admin_identity() -> tuple[str, str]:
    command = (
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF "|" '
        "-c \"SELECT id,email FROM users WHERE role='admin' "
        'ORDER BY created_at LIMIT 2\"'
    )
    result = subprocess.run(
        ["docker", "exec", CONTROL_DB_CONTAINER, "sh", "-lc", command],
        check=True,
        capture_output=True,
        text=True,
    )
    rows = [line.split("|", 1) for line in result.stdout.splitlines() if line]
    if len(rows) != 1 or len(rows[0]) != 2:
        raise DeploymentError("DockPanel must contain exactly one admin account")
    return rows[0][0], rows[0][1]


def b64url(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def session_token(jwt_secret: str, admin_id: str, email: str) -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(
        json.dumps(
            {
                "sub": admin_id,
                "email": email,
                "role": "admin",
                "iat": now,
                "exp": now + 300,
                "jti": str(uuid.uuid4()),
            },
            separators=(",", ":"),
        ).encode()
    )
    signing_input = header + b"." + payload
    signature = b64url(hmac.new(jwt_secret.encode(), signing_input, hashlib.sha256).digest())
    return (signing_input + b"." + signature).decode()


def api_get(path: str, token: str) -> object:
    request = urllib.request.Request(
        f"{API_BASE}/{path.lstrip('/')}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise DeploymentError(f"DockPanel API returned HTTP {exc.code}") from exc


def pull_vault(token: str, vault_name: str) -> dict[str, str]:
    vaults = api_get("secrets/vaults", token)
    if not isinstance(vaults, list):
        raise DeploymentError("DockPanel returned an invalid vault list")
    matches = [vault for vault in vaults if vault.get("name") == vault_name]
    if len(matches) != 1:
        raise DeploymentError(f"Expected exactly one DockPanel vault named {vault_name!r}")

    entries = api_get(f"secrets/vaults/{matches[0]['id']}/pull", token)
    if not isinstance(entries, list):
        raise DeploymentError("DockPanel returned an invalid secret list")

    values: dict[str, str] = {}
    for entry in entries:
        key = entry.get("key")
        value = entry.get("value")
        if not isinstance(key, str) or not ENV_KEY.fullmatch(key) or not isinstance(value, str):
            raise DeploymentError("DockPanel returned an invalid secret entry")
        if key in values:
            raise DeploymentError(f"Duplicate secret key in vault: {key}")
        values[key] = value

    missing = sorted(key for key in REQUIRED_KEYS if not values.get(key))
    if missing:
        raise DeploymentError(f"Required DockPanel secrets are missing: {', '.join(missing)}")
    return values


def managed_keys(compose_file: Path) -> set[str]:
    example = compose_file.parent / ".env.example"
    keys: set[str] = set()
    for line in example.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if ENV_KEY.fullmatch(key):
            keys.add(key)
    return keys


def wait_until_healthy(timeout_seconds: int = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_state = "unknown"
    while time.monotonic() < deadline:
        result = subprocess.run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}",
                CONTAINER_NAME,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            last_state = result.stdout.strip()
            status, health, restarts = last_state.split("|", 2)
            if status == "running" and health in {"healthy", "none"} and restarts == "0":
                return
        time.sleep(2)
    raise DeploymentError(f"Container did not become healthy: {last_state}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate vault access without deploying")
    parser.add_argument("--compose-file", type=Path, default=DEFAULT_COMPOSE_FILE)
    parser.add_argument("--vault", default=DEFAULT_VAULT)
    args = parser.parse_args()

    if os.geteuid() != 0:
        raise DeploymentError("This command must run as root")
    compose_file = args.compose_file.resolve(strict=True)

    jwt_secret = load_env_value(API_ENV, "JWT_SECRET")
    admin_id, email = admin_identity()
    token = session_token(jwt_secret, admin_id, email)
    values = pull_vault(token, args.vault)
    print(f"DockPanel vault validated: {len(values)} entries")
    if args.check:
        return 0

    child_env = os.environ.copy()
    for key in managed_keys(compose_file):
        child_env.pop(key, None)
    child_env.update(values)
    subprocess.run(
        ["docker", "compose", "-f", str(compose_file), "up", "-d", "--build", "--force-recreate"],
        cwd=compose_file.parent,
        env=child_env,
        check=True,
    )
    wait_until_healthy()
    print(f"{CONTAINER_NAME} is healthy")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DeploymentError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"deploy failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
