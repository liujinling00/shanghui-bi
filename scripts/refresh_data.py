from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
INPUT_XLSX = ROOT / "data" / "商会BI数据.xlsx"
OUTPUT_JSON = ROOT / "data" / "members.json"
SHEET_NAME = "会员数据"

PUBLIC_COLUMNS = [
    "序号",
    "会员姓名",
    "会内职位",
    "单位名称",
    "性别",
    "年龄段",
    "政治面貌分类",
    "所属行业",
    "区域",
    "城市",
    "注册地址",
    "申请年份",
    "lng",
    "lat",
    "好人好事标记",
]

ALIASES = {
    "姓名": "会员姓名",
    "政治面貌": "政治面貌分类",
    "行业": "所属行业",
    "经度": "lng",
    "纬度": "lat",
}


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()


def number(value: Any) -> float | int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        match = re.search(r"-?\d+(?:\.\d+)?", text(value))
        if not match:
            return None
        parsed = float(match.group(0))
    return int(parsed) if parsed.is_integer() else parsed


def year(value: Any) -> int | None:
    if isinstance(value, (datetime, date)):
        return value.year
    parsed = number(value)
    if parsed is not None and 1900 <= parsed <= 2200:
        return int(parsed)
    match = re.search(r"(19|20)\d{2}", text(value))
    return int(match.group(0)) if match else None


def normalize_headers(row: tuple[Any, ...]) -> list[str]:
    headers = []
    for value in row:
        header = text(value)
        headers.append(ALIASES.get(header, header))
    return headers


def read_members() -> list[dict[str, Any]]:
    if not INPUT_XLSX.exists():
        raise FileNotFoundError(f"找不到数据文件：{INPUT_XLSX}")

    workbook = load_workbook(INPUT_XLSX, read_only=True, data_only=True)
    if SHEET_NAME not in workbook.sheetnames:
        raise ValueError(f"Excel 必须包含工作表：{SHEET_NAME}")

    sheet = workbook[SHEET_NAME]
    rows = sheet.iter_rows(values_only=True)
    headers = normalize_headers(next(rows, ()))
    index = {header: position for position, header in enumerate(headers) if header}

    missing = [field for field in ("会员姓名", "会内职位", "单位名称") if field not in index]
    if missing:
        raise ValueError("缺少必要列：" + "、".join(missing))

    members: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows, start=2):
        name = text(row[index["会员姓名"]] if index["会员姓名"] < len(row) else "")
        if not name:
            continue

        item: dict[str, Any] = {}
        for field in PUBLIC_COLUMNS:
            position = index.get(field)
            value = row[position] if position is not None and position < len(row) else None
            if field == "序号":
                item[field] = int(number(value) or len(members) + 1)
            elif field in {"lng", "lat"}:
                item[field] = number(value)
            elif field == "申请年份":
                item[field] = year(value)
            else:
                item[field] = text(value)

        item["_excel_row"] = row_number
        members.append(item)

    members.sort(key=lambda item: (item["序号"], item["会员姓名"]))
    for item in members:
        item.pop("_excel_row", None)
    return members


def main() -> None:
    members = read_members()
    OUTPUT_JSON.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"已生成 {OUTPUT_JSON}：{len(members)} 条会员数据")


if __name__ == "__main__":
    main()
