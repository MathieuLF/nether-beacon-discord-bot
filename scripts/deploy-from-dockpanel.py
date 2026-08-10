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
CONTAINER_NAMES = ("nether-beacon", "nether-beacon-muse")
DOCKER_EXECUTABLE = "/usr/bin/docker"
TRUSTED_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
REQUIRED_KEYS = {"DISCORD_GUILD_ID", "DISCORD_BOT_TOKEN", "MUSE_DISCORD_TOKEN"}
ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ALLOWED_KEYS = frozenset(
    {
        "DISCORD_GUILD_ID",
        "DISCORD_BOT_TOKEN",
        "MUSE_DISCORD_TOKEN",
        "MUSE_YOUTUBE_API_KEY",
        "MUSE_SPOTIFY_CLIENT_ID",
        "MUSE_SPOTIFY_CLIENT_SECRET",
        "MUSE_CACHE_LIMIT",
        "MUSE_YT_DLP_AUTO_UPDATE",
        "MUSE_ENABLE_SPONSORBLOCK",
        "MUSE_BOT_STATUS",
        "MUSE_BOT_ACTIVITY_TYPE",
        "MUSE_BOT_ACTIVITY",
        "BOT_PROFILE",
        "BOT_TIMEZONE",
        "BOT_RUNTIME_DIR",
        "BOT_STATS_EVENT_DEBOUNCE_MS",
        "BOT_STATS_VOICE_REFRESH_INTERVAL_MS",
        "BOT_POKEAPI_CACHE_TTL_DAYS",
        "BOT_POKEAPI_MAX_ASSET_BYTES",
        "BOT_POKEAPI_MAX_JSON_BYTES",
        "BOT_POKEAPI_MAX_MEMORY_ENTRIES",
        "BOT_POKEAPI_MAX_CACHE_BYTES",
        "BOT_POKEAPI_MAX_CACHE_FILES",
        "BOT_POKEAPI_MAX_CONCURRENT_REQUESTS",
        "BOT_POKEAPI_GLOBAL_COOLDOWN_MS",
        "BOT_PALWORLD_CHANNEL_NAME",
        "BOT_PALWORLD_PUBLIC_FETCH_TIMEOUT_MS",
        "BOT_PALWORLD_PUBLIC_CACHE_TTL_MS",
        "BOT_PALWORLD_REST_API_URL",
        "BOT_PALWORLD_REST_API_USERNAME",
        "BOT_PALWORLD_REST_API_PASSWORD",
        "BOT_PALWORLD_REST_FETCH_TIMEOUT_MS",
        "BOT_PALWORLD_REST_CIRCUIT_BREAKER_MS",
        "BOT_PALWORLD_METRICS_COOLDOWN_MS",
        "BOT_PALWORLD_ADMIN_COOLDOWN_MS",
        "BOT_PALWORLD_ADMIN_CHANNEL_IDS",
        "BOT_PALWORLD_ADMIN_CHANNEL_NAMES",
        "GAYLEMON_PUBLIC_BASE_URL",
        "GAYLEMON_DAILY_SUMMARY_TIME_ZONE",
        "GAYLEMON_DAILY_SUMMARY_FETCH_TIMEOUT_MS",
        "GAYLEMON_DAILY_SUMMARY_MAX_JSON_BYTES",
        "GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_IDS",
        "GAYLEMON_DAILY_SUMMARY_COMMAND_CHANNEL_NAMES",
    }
)


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
        [DOCKER_EXECUTABLE, "exec", CONTROL_DB_CONTAINER, "sh", "-lc", command],
        check=True,
        capture_output=True,
        text=True,
        env=build_child_env({}),
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
        if key not in ALLOWED_KEYS:
            raise DeploymentError(f"Unexpected secret key in vault: {key}")
        if key in values:
            raise DeploymentError(f"Duplicate secret key in vault: {key}")
        values[key] = value

    missing = sorted(key for key in REQUIRED_KEYS if not values.get(key))
    if missing:
        raise DeploymentError(f"Required DockPanel secrets are missing: {', '.join(missing)}")
    return values


def build_child_env(values: dict[str, str]) -> dict[str, str]:
    unexpected = sorted(set(values) - ALLOWED_KEYS)
    if unexpected:
        raise DeploymentError(f"Unexpected environment keys: {', '.join(unexpected)}")
    return {
        "PATH": TRUSTED_PATH,
        "HOME": "/root",
        "LANG": "C.UTF-8",
        "DOCKER_HOST": "unix:///var/run/docker.sock",
        **values,
    }


def wait_until_healthy(timeout_seconds: int = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_states = {name: "unknown" for name in CONTAINER_NAMES}
    while time.monotonic() < deadline:
        all_healthy = True
        for container_name in CONTAINER_NAMES:
            result = subprocess.run(
                [
                    DOCKER_EXECUTABLE,
                    "inspect",
                    "--format",
                    "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}",
                    container_name,
                ],
                capture_output=True,
                text=True,
                env=build_child_env({}),
            )
            if result.returncode != 0:
                all_healthy = False
                continue
            last_states[container_name] = result.stdout.strip()
            status, health, restarts = last_states[container_name].split("|", 2)
            if status != "running" or health != "healthy" or restarts != "0":
                all_healthy = False
        if all_healthy:
            return
        time.sleep(2)
    raise DeploymentError(f"Containers did not become healthy: {last_states}")


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

    child_env = build_child_env(values)
    subprocess.run(
        [DOCKER_EXECUTABLE, "compose", "-f", str(compose_file), "up", "-d", "--build", "--force-recreate"],
        cwd=compose_file.parent,
        env=child_env,
        check=True,
    )
    wait_until_healthy()
    print(f"{', '.join(CONTAINER_NAMES)} are healthy")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DeploymentError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"deploy failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
