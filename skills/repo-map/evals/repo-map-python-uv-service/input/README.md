# shortlinks

Internal URL shortener. Stores short codes in memory (Redis adapter planned)
and exposes a small HTTP API for creating and resolving links.

Run locally:

```sh
uv run uvicorn shortlinks.main:app --reload
```
