import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "deploy-from-dockpanel.py"
SPEC = importlib.util.spec_from_file_location("deploy_from_dockpanel", SCRIPT)
deploy = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(deploy)


class DeployFromDockPanelSecurityTests(unittest.TestCase):
    def test_public_environment_template_matches_the_static_allowlist(self):
        example = SCRIPT.parents[1] / ".env.example"
        keys = {
            line.split("=", 1)[0].strip()
            for line in example.read_text(encoding="utf-8").splitlines()
            if "=" in line and not line.lstrip().startswith("#")
        }
        self.assertEqual(keys, set(deploy.ALLOWED_KEYS))

    def test_vault_rejects_control_and_unknown_variables(self):
        for forbidden in ("DOCKER_HOST", "DOCKER_CONTEXT", "COMPOSE_PROJECT_NAME", "PATH", "UNKNOWN_KEY"):
            with self.subTest(forbidden=forbidden):
                responses = [
                    [{"id": "vault-1", "name": "nether-beacon-production"}],
                    [
                        {"key": "DISCORD_GUILD_ID", "value": "123"},
                        {"key": "DISCORD_BOT_TOKEN", "value": "alpha"},
                        {"key": "MUSE_DISCORD_TOKEN", "value": "muse"},
                        {"key": forbidden, "value": "attacker-controlled"},
                    ],
                ]
                with patch.object(deploy, "api_get", side_effect=responses):
                    with self.assertRaisesRegex(deploy.DeploymentError, "Unexpected secret key"):
                        deploy.pull_vault("token", "nether-beacon-production")

    def test_child_environment_is_minimal_and_pins_local_docker(self):
        child_env = deploy.build_child_env({"DISCORD_BOT_TOKEN": "alpha"})
        self.assertEqual(child_env["DOCKER_HOST"], "unix:///var/run/docker.sock")
        self.assertEqual(child_env["PATH"], deploy.TRUSTED_PATH)
        self.assertNotIn("DOCKER_CONTEXT", child_env)
        self.assertNotIn("COMPOSE_PROJECT_NAME", child_env)
        self.assertEqual(child_env["DISCORD_BOT_TOKEN"], "alpha")

    def test_child_environment_rejects_unknown_keys(self):
        with self.assertRaisesRegex(deploy.DeploymentError, "Unexpected environment keys"):
            deploy.build_child_env({"PATH": "/tmp"})

    def test_docker_executable_is_absolute(self):
        self.assertTrue(deploy.DOCKER_EXECUTABLE.startswith("/"))
        self.assertEqual(deploy.DOCKER_EXECUTABLE, "/usr/bin/docker")


if __name__ == "__main__":
    unittest.main()
