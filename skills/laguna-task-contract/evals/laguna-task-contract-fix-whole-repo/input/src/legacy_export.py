# TODO: drop this once the v2 exporter ships
import csv
import io


def export_rows(rows):
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow([row.get("id"), row.get("name")])  # TODO: configurable columns
    return buf.getvalue()
