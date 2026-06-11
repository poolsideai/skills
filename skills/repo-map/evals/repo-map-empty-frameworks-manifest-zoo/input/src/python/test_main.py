"""Tests for Python main module."""

from main import greet


def test_greet():
    assert greet("Alice") == "Hello from Python, Alice!"
