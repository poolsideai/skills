"""FastAPI application entrypoint: `uvicorn shortlinks.main:app`."""

from fastapi import FastAPI, HTTPException

from shortlinks.store import LinkStore

app = FastAPI(title="shortlinks")
store = LinkStore()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/links")
def create_link(url: str) -> dict[str, str]:
    code = store.add(url)
    return {"code": code, "url": url}


@app.get("/links/{code}")
def resolve_link(code: str) -> dict[str, str]:
    url = store.resolve(code)
    if url is None:
        raise HTTPException(status_code=404, detail="unknown code")
    return {"code": code, "url": url}
