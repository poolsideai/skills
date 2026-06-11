# TODO: rewrite this module, it has grown organically
def merge_rows(rows):
    merged = {}
    for row in rows:
        key = row["id"]
        if key in merged:
            merged[key].update(row)  # TODO: deep-merge nested fields
        else:
            merged[key] = dict(row)
    return list(merged.values())
