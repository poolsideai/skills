"""Shared LM client for harness-side LM calls (optimization + generation tracks).

One client, two callers: gepa_skill.py (reflection LM) and
harness/generate/gen_eval_cases.py (case synthesis). Both speak litellm model
ids, so every litellm provider works out of the box:

- Anthropic:   ``anthropic/claude-sonnet-4-5``        (ANTHROPIC_API_KEY)
- OpenRouter:  ``openrouter/anthropic/claude-sonnet-4.5`` (OPENROUTER_API_KEY,
               optional OPENROUTER_API_BASE override)
- Any OpenAI-compatible endpoint (vLLM, llama.cpp server, LiteLLM proxy,
  OpenRouter-as-generic, tenant gateways): pass ``api_base`` and the model id
  that endpoint serves. The wrapper uses LiteLLM's custom OpenAI provider path
  so ids such as ``openai/gpt-5.5`` are sent literally instead of being stripped
  to ``gpt-5.5``. The key comes from ``api_key_env`` (your choice of env var)
  or litellm's own resolution (OPENAI_API_KEY).

This module deliberately has NO import-time litellm dependency cost beyond
the callers that already declare it (PEP 723 scripts with ``litellm`` in
their dependency block). Never imported by validators or skill scripts —
those are bun/TS and network-free by contract.
"""

from __future__ import annotations

import os
from typing import Any, Callable

#: Callable contract shared with gepa's LanguageModel protocol:
#: (prompt | messages) -> completion text.
LMCallable = Callable[[Any], str]


def resolve_model(model: str, api_base: str | None) -> str:
    """litellm routing: a bare model name + explicit api_base means an
    OpenAI-compatible endpoint, which litellm addresses as ``openai/<name>``.
    Ids that already carry a provider prefix (``openrouter/...``,
    ``anthropic/...``, ``openai/...``) pass through untouched. ``make_lm`` now
    bypasses this helper for explicit api_base calls so gateway-served ids are
    preserved literally."""
    if api_base and "/" not in model:
        return f"openai/{model}"
    return model


def make_lm(
    model: str,
    *,
    api_base: str | None = None,
    api_key_env: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> LMCallable:
    """Build a ``(prompt | messages) -> str`` callable over litellm.

    Raises RuntimeError eagerly when ``api_key_env`` names an unset env var —
    a misconfigured key must abort before any search/generation spend, not
    surface as a mid-run auth error.
    """
    import litellm  # deferred: callers are PEP 723 scripts that declare it

    # For explicit OpenAI-compatible gateways, LiteLLM's normal ``openai/...``
    # provider route strips the provider prefix before sending the request. The
    # Poolside gateway serves ids such as ``openai/gpt-5.5`` literally, so use
    # the custom OpenAI provider path to preserve the caller's model id.
    resolved = model if api_base else resolve_model(model, api_base)
    api_key: str | None = None
    if api_key_env:
        api_key = os.environ.get(api_key_env)
        if not api_key:
            raise RuntimeError(
                f"--api-key-env {api_key_env!r} is set but ${api_key_env} is empty/unset"
            )

    def lm(prompt: Any) -> str:
        messages = [{"role": "user", "content": prompt}] if isinstance(prompt, str) else prompt
        kwargs: dict[str, Any] = {}
        if api_base:
            kwargs["api_base"] = api_base
            kwargs["custom_llm_provider"] = "custom_openai"
        if api_key:
            kwargs["api_key"] = api_key
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        if temperature is not None:
            kwargs["temperature"] = temperature
        response = litellm.completion(model=resolved, messages=messages, **kwargs)
        content = response.choices[0].message.content
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError(f"LM {resolved} returned empty content")
        return content

    return lm
