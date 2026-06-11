# imgcache

Thumbnail caching proxy.

> NOTE: parts of this README predate the 0.5 rewrite and have not been
> updated.

## Architecture

The service has two halves:

- The **Django admin dashboard** under `frontend/` — staff manage cache
  eviction policies there. Start it with `python manage.py runserver` after
  installing the requirements.
- The **React status widget** in `frontend/widget/`, embedded in the internal
  ops portal. Run `npm test` for the JS test suite before touching it.

The caching core proxies image requests, renders thumbnails, and stores them
keyed by content hash.

## Operations

Eviction policy docs live in the ops wiki. For the Rust side, the usual cargo
workflow applies.
