"""Tests for main module."""

import pytest
from src.main import main

def test_main_returns_zero():
    assert main() == 0

def test_main_runs_without_error():
    """Smoke test that main executes."""
    result = main()
    assert result is not None
