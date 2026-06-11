import pytest
from src.utils.string_util import sanitize, truncate

def test_sanitize_basic():
    assert sanitize("  hello  world  ") == "hello world"

def test_sanitize_empty():
    # Currently missing — this is the bug
    pass

def test_truncate():
    assert truncate("hello world", 8) == "hello..."
