"""Convert the USDA FPED workbook (FPED_2123.xls, sheet 1) to CSV.

Usage:  python -I scripts/fped-xls-to-csv.py FPED_2123.xls fped.csv
Needs:  pip install xlrd   (the only reason this helper is Python: FPED ships as legacy .xls)

Writes the data sheet verbatim: header row as published, FOODCODE as an integer string,
numeric cells as plain decimals. Nothing is filled in or defaulted.
"""
import csv
import sys

import xlrd


def cell_text(cell):
    if cell.ctype == xlrd.XL_CELL_EMPTY:
        return ""
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        v = cell.value
        return str(int(v)) if v == int(v) else repr(v)
    return str(cell.value)


def main(src, dst):
    sheet = xlrd.open_workbook(src).sheet_by_index(0)
    with open(dst, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        for r in range(sheet.nrows):
            w.writerow([cell_text(c) for c in sheet.row(r)])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
