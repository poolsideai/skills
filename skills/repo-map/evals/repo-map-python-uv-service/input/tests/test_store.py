from shortlinks.store import LinkStore


def test_add_then_resolve_roundtrip() -> None:
    store = LinkStore()
    code = store.add("https://internal.example/wiki/oncall")
    assert store.resolve(code) == "https://internal.example/wiki/oncall"


def test_resolve_unknown_code_returns_none() -> None:
    store = LinkStore()
    assert store.resolve("deadbeef") is None
