from __future__ import annotations

import sys
import types
import unittest

from harness.llm import make_lm


class HarnessLmTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_litellm = sys.modules.get("litellm")

    def tearDown(self) -> None:
        if self.original_litellm is None:
            sys.modules.pop("litellm", None)
        else:
            sys.modules["litellm"] = self.original_litellm

    def install_fake_litellm(self, calls: list[dict]) -> None:
        def completion(**kwargs):
            calls.append(kwargs)
            message = types.SimpleNamespace(content="candidate text")
            choice = types.SimpleNamespace(message=message)
            return types.SimpleNamespace(choices=[choice])

        sys.modules["litellm"] = types.SimpleNamespace(completion=completion)

    def test_openrouter_reasoning_effort_uses_provider_reasoning_shape(self) -> None:
        calls: list[dict] = []
        self.install_fake_litellm(calls)

        lm = make_lm("openrouter/openai/gpt-5.4", reasoning_effort="medium")

        self.assertEqual(lm("rewrite this"), "candidate text")
        self.assertEqual(calls[0]["model"], "openrouter/openai/gpt-5.4")
        self.assertEqual(calls[0]["reasoning"], {"effort": "medium", "exclude": True})
        self.assertNotIn("reasoning_effort", calls[0])

    def test_non_openrouter_reasoning_effort_uses_openai_style_param(self) -> None:
        calls: list[dict] = []
        self.install_fake_litellm(calls)

        lm = make_lm("openai/gpt-5.4", reasoning_effort="low")

        self.assertEqual(lm("rewrite this"), "candidate text")
        self.assertEqual(calls[0]["model"], "openai/gpt-5.4")
        self.assertEqual(calls[0]["reasoning_effort"], "low")
        self.assertNotIn("reasoning", calls[0])


if __name__ == "__main__":
    unittest.main()
