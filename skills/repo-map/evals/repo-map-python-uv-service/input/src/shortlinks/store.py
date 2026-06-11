"""In-memory link store. A Redis-backed adapter is planned but not built."""

import hashlib


class LinkStore:
    def __init__(self) -> None:
        self._links: dict[str, str] = {}

    def add(self, url: str) -> str:
        code = hashlib.sha256(url.encode()).hexdigest()[:8]
        self._links[code] = url
        return code

    def resolve(self, code: str) -> str | None:
        return self._links.get(code)
