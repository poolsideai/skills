from src.report_utils import merge_rows


def test_merge_rows_keeps_last_value():
    rows = [{"id": 1, "name": "a"}, {"id": 1, "name": "b"}]
    assert merge_rows(rows) == [{"id": 1, "name": "b"}]


def test_merge_rows_preserves_insertion_order():
    rows = [{"id": 2}, {"id": 1}]
    assert [r["id"] for r in merge_rows(rows)] == [2, 1]
