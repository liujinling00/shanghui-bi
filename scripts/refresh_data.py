# -*- coding: utf-8 -*-
"""
商会 BI 数据管道

把 data/商会BI数据.xlsx 的「会员总表」转换成网页读取的 data/members.json。

派生字段（表里没有、由脚本算出来）：
  年龄 / 年龄段      ← 生日
  申请年份 / 会龄    ← 申请时间
  政治面貌归类        ← 政治面貌（5 大类）
  职位归类            ← 会内职位
  区域 / 城市 / 坐标  ← 优先沿用旧版人工校正结果，其次从注册地址解析

隐私：电话、生日、身份证等不会写入 members.json。

用法：python scripts/refresh_data.py
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
# 数据库源默认放在 data/ 下；也可用命令行传入仓库外的路径：
#   python scripts/refresh_data.py "D:\商会资料\商会BI数据.xlsx"
INPUT_XLSX = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else ROOT / "data" / "商会BI数据.xlsx"
OUTPUT_JSON = ROOT / "data" / "members.json"
LEGACY_JSON = ROOT / "data" / "legacy_coords.json"   # 旧版人工校正过的区域/坐标
SHEET_CANDIDATES = ("会员总表", "会员数据")

TODAY = date.today()

# ---------------------------------------------------------------- 行政区划
SHENYANG_DISTRICTS = {
    "和平区": (123.3890, 41.7460),
    "沈河区": (123.4457, 41.7956),
    "大东区": (123.5121, 41.8612),
    "皇姑区": (123.4256, 41.8595),
    "铁西区": (123.1194, 41.6735),
    "苏家屯区": (123.4190, 41.5832),
    "浑南区": (123.6273, 41.7648),
    "沈北新区": (123.4968, 42.0353),
    "于洪区": (123.2537, 41.9061),
    "辽中区": (122.7446, 41.5532),
    "康平县": (123.2675, 42.7590),
    "法库县": (123.2393, 42.4086),
    "新民市": (122.8580, 42.0096),
}

CITY_CENTERS = {
    "沈阳": (123.4300, 41.8000),
    "大连": (121.6200, 38.9200),
    "鞍山": (122.9900, 41.1100),
    "抚顺": (123.9600, 41.8700),
    "本溪": (123.7700, 41.3000),
    "丹东": (124.3800, 40.1300),
    "锦州": (121.1300, 41.1000),
    "营口": (122.2300, 40.6700),
    "阜新": (121.6700, 42.0200),
    "辽阳": (123.1700, 41.2700),
    "盘锦": (122.0700, 41.1200),
    "铁岭": (123.8400, 42.2900),
    "朝阳": (120.4500, 41.5700),
    "葫芦岛": (120.8400, 40.7100),
}

# 地址 -> 区县 关键词（顺序敏感，先长后短）
DISTRICT_HINTS = [
    ("沈北新区", "沈北新区"), ("沈北", "沈北新区"), ("新城子", "沈北新区"),
    ("浑南", "浑南区"), ("东陵", "浑南区"), ("沈抚新区", "浑南区"), ("自贸区", "浑南区"),
    ("苏家屯", "苏家屯区"), ("和平区", "和平区"), ("沈河区", "沈河区"),
    ("大东区", "大东区"), ("皇姑区", "皇姑区"), ("铁西区", "铁西区"),
    ("于洪区", "于洪区"), ("辽中区", "辽中区"), ("辽中", "辽中区"),
    ("康平县", "康平县"), ("法库县", "法库县"), ("新民市", "新民市"),
    ("经济技术开发区", "铁西区"), ("开发区", "铁西区"),
    ("东北大马路", "大东区"), ("黄河北大街", "皇姑区"), ("南塔", "沈河区"),
    ("三好街", "和平区"), ("中街", "沈河区"), ("太原街", "和平区"),
    ("青年大街", "沈河区"), ("北站", "沈河区"),
]

CITY_NAMES = list(CITY_CENTERS.keys())

DISTRICTS_OTHER = {"其他"}


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()


def to_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = text(value)
    if not raw:
        return None
    m = re.search(r"(\d{4})\D{1,2}(\d{1,2})(?:\D{1,2}(\d{1,2}))?", raw)
    if not m:
        return None
    y, mth, d = int(m.group(1)), int(m.group(2)), int(m.group(3) or 1)
    try:
        return date(y, mth, d)
    except ValueError:
        return None


def parse_address(addr: str) -> tuple[str | None, str | None]:
    """从注册地址里解析 (城市, 区县)。"""
    raw = text(addr).replace("#", " ").replace("\n", " ")
    if not raw:
        return None, None

    city = None
    if "上海" in raw:
        return "上海", None
    if "北京" in raw:
        return "北京", None
    if "沈阳" in raw or "新民" in raw:
        city = "沈阳"
    else:
        for name in CITY_NAMES:
            if name in raw:
                city = name
                break
        if city is None:
            if "北票" in raw:
                city = "朝阳"
            elif "桓仁" in raw:
                city = "本溪"
            elif "昌图" in raw:
                city = "铁岭"
            elif "鲅鱼圈" in raw:
                city = "营口"

    district = None
    for kw, value in DISTRICT_HINTS:
        if kw in raw:
            district = value
            break
    if district and city is None and district in SHENYANG_DISTRICTS:
        city = "沈阳"
    return city, district


def political_group(value: str) -> str:
    raw = text(value)
    if not raw or raw in {"未知", "无"}:
        return "未登记"
    if raw == "中共党员":
        return "中共党员"
    if raw in {"共青团员", "团员"}:
        return "共青团员"
    if raw == "无党派人士":
        return "无党派人士"
    if raw == "群众":
        return "群众"
    if any(k in raw for k in ("民建", "民进", "民盟", "九三", "致公", "农工", "民革", "台盟")):
        return "民主党派"
    return "群众"


POSITION_GROUPS = {
    "会长": "会长",
    "副会长": "副会长",
    "副会长兼秘书长": "副会长",
    "理事": "理事",
    "副秘书长\\理事": "理事",
    "副秘书长/理事": "理事",
    "第一届原副会长": "其他",
    "独立监事": "其他",
    "秘书处工作人员": "其他",
}

# 理事会成员：除「会员」和「第一届原副会长」之外的所有在册人员（秘书处按用户口径计入）
NOT_COUNCIL = {"会员", "第一届原副会长"}


def position_group(value: str) -> str:
    raw = text(value)
    return POSITION_GROUPS.get(raw, "会员" if raw in {"会员", ""} else "其他")


def in_council(value: str) -> bool:
    raw = text(value)
    return raw != "" and raw not in NOT_COUNCIL


def age_of(birth: date | None) -> int | None:
    if not birth:
        return None
    age = TODAY.year - birth.year - ((TODAY.month, TODAY.day) < (birth.month, birth.day))
    return age if 0 <= age <= 110 else None


def age_band(age: int | None) -> str:
    if age is None:
        return "未登记"
    if age < 30:
        return "30岁以下"
    if age < 40:
        return "30-39岁"
    if age < 50:
        return "40-49岁"
    if age < 60:
        return "50-59岁"
    return "60岁以上"


def sub_industry(value: str) -> str:
    """行业分类：制造业>通用设备制造业>金属加工机械制造(C342) -> 通用设备制造业"""
    parts = [p.strip() for p in text(value).split(">") if p.strip()]
    if not parts:
        return ""
    pick = parts[1] if len(parts) >= 3 else parts[-1]
    return re.sub(r"[（(][^）)]*[)）]", "", pick).strip()


def age_at(birth: date | None, when: date | None) -> int | None:
    if not birth or not when:
        return None
    age = when.year - birth.year - ((when.month, when.day) < (birth.month, birth.day))
    return age if 0 <= age <= 110 else None


FEE_RANGE = re.compile(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*[-—–~至]\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})")


def fee_end(value: str) -> date | None:
    ends = []
    for m in FEE_RANGE.finditer(text(value)):
        try:
            ends.append(date(int(m.group(4)), int(m.group(5)), int(m.group(6))))
        except ValueError:
            continue
    return max(ends) if ends else None


def fee_status(end: date | None) -> str:
    if not end:
        return "未登记"
    return "有效" if end >= TODAY else "已到期"


def num_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        m = re.search(r"-?\d+(?:\.\d+)?", text(value))
        return round(float(m.group(0)), 2) if m else None


TAG_KEYS = ["高新技术企业", "专精特新", "科技型中小企业", "小微企业", "国有企业", "瞪羚", "雏鹰", "小巨人"]


def good_deeds_count(value: str) -> int:
    raw = text(value)
    if not raw:
        return 0
    parts = [p for p in re.split(r"[；;\n]+", raw) if p.strip()]
    return max(1, len(parts))


def jitter(seed: str, span: float = 0.018) -> float:
    h = int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:8], 16)
    return ((h % 2000) / 2000 - 0.5) * span


def round6(v: float) -> float:
    return round(v, 6)


def read_assessment(wb) -> dict[str, dict[str, Any]]:
    """读取「商会会员考核明细表」，按姓名索引。"""
    sheet = next((n for n in wb.sheetnames if n.startswith("商会会员考核")), None)
    if not sheet:
        return {}
    ws = wb[sheet]
    rows = ws.iter_rows(values_only=True)
    header = [text(c) for c in next(rows, ())]
    idx = {h: i for i, h in enumerate(header) if h}

    def pick(row, *keys):
        for k in keys:
            if k in idx and idx[k] < len(row):
                return row[idx[k]]
        return None

    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        person = text(pick(row, "姓名", "会员姓名"))
        if not person:
            continue
        out[person] = {
            "考核总分": num_or_none(pick(row, "年度总分")),
            "考核常规分": num_or_none(pick(row, "常规得分")),
            "考核活动分": num_or_none(pick(row, "加分-活动总分")),
            "考核赞助分": num_or_none(pick(row, "加分-赞助总分")),
            "考核好事分": num_or_none(pick(row, "加分-好事总分")),
            "考核品行": text(pick(row, "思想品行（前提）", "思想品行")),
            "考核减分": num_or_none(pick(row, "减分项目（10分）", "减分项目")),
            "考核常规次数": num_or_none(pick(row, "常规次数")),
            "考核加分次数": num_or_none(pick(row, "加分-活动次数")),
        }
    return out


def main() -> None:
    if not INPUT_XLSX.exists():
        raise SystemExit(
            f"找不到数据文件：{INPUT_XLSX}\n"
            "请把 Excel 放在 data/ 下，或用命令行指定路径：\n"
            "  python scripts/refresh_data.py \"D:\\资料\\商会BI数据.xlsx\""
        )

    wb = load_workbook(INPUT_XLSX, read_only=True, data_only=True)
    sheet_name = next((n for n in SHEET_CANDIDATES if n in wb.sheetnames), None)
    if sheet_name is None:
        raise SystemExit(f"Excel 里找不到工作表：{' / '.join(SHEET_CANDIDATES)}")
    ws = wb[sheet_name]

    assessment = read_assessment(wb)

    legacy: dict[str, dict[str, Any]] = {}
    if LEGACY_JSON.exists():
        legacy = json.loads(LEGACY_JSON.read_text(encoding="utf-8"))

    rows = ws.iter_rows(values_only=True)
    header = [text(c) for c in next(rows, ())]
    idx = {h: i for i, h in enumerate(header) if h}

    required = ("会员姓名", "会内职位", "单位名称")
    missing = [c for c in required if c not in idx]
    if missing:
        raise SystemExit("缺少必要列：" + "、".join(missing))

    def cell(row: tuple[Any, ...], name: str) -> Any:
        i = idx.get(name)
        return row[i] if i is not None and i < len(row) else None

    members: list[dict[str, Any]] = []
    for row in rows:
        name = text(cell(row, "会员姓名"))
        if not name:
            continue

        address = re.sub(r"^中国#?", "", text(cell(row, "注册地址")))
        address = re.sub(r"[#\n\r]+", " ", address)
        address = re.sub(r"\s{2,}", " ", address).strip()
        city, district = parse_address(address)
        old = legacy.get(name, {})

        old_city = text(old.get("城市"))
        old_district = text(old.get("区域"))
        if old_city and old_city != "未知":
            city = old_city
        if old_district and old_district not in DISTRICTS_OTHER:
            district = old_district
        elif district is None and old_district:
            district = old_district

        if district is None:
            district = "其他"
        if city is None:
            city = "未知"

        lng, lat = old.get("lng"), old.get("lat")
        if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
            center = SHENYANG_DISTRICTS.get(district) or CITY_CENTERS.get(city)
            if center:
                lng = round6(center[0] + jitter(name + "x"))
                lat = round6(center[1] + jitter(name + "y"))
            else:
                lng = lat = None

        applied = to_date(cell(row, "申请时间"))
        birth = to_date(cell(row, "生日"))
        age = age_of(birth)
        deeds = text(cell(row, "好人好事"))

        fee_text = text(cell(row, "会费缴纳情况"))
        fee_due = fee_end(fee_text)
        tags_raw = text(cell(row, "企查查查询"))
        tags = [k for k in TAG_KEYS if k in tags_raw]
        assess = assessment.get(name, {})

        members.append({
            "序号": int(float(cell(row, "序号") or len(members) + 1)),
            "会员姓名": name,
            "会内职位": text(cell(row, "会内职位")) or "会员",
            "职位归类": position_group(text(cell(row, "会内职位"))),
            "理事会": in_council(text(cell(row, "会内职位"))),
            "单位名称": text(cell(row, "单位名称")),
            "性别": text(cell(row, "性别")) or "未登记",
            "年龄": age,
            "年龄段": age_band(age),
            "生日月": birth.month if birth else None,
            "政治面貌": text(cell(row, "政治面貌")) or "未登记",
            "政治面貌归类": political_group(text(cell(row, "政治面貌"))),
            "所属行业": text(cell(row, "所属行业")) or "未登记",
            "行业细分": text(cell(row, "行业分类")),
            "细分行业": sub_industry(text(cell(row, "行业分类"))),
            "经营范围": text(cell(row, "经营范围")),
            "区域": district,
            "城市": city,
            "省内": city in CITY_CENTERS,
            "注册地址": address,
            "申请日期": applied.isoformat() if applied else "",
            "申请年份": applied.year if applied else None,
            "会龄月": max(0, (TODAY - applied).days // 30) if applied else None,
            "入会年龄": age_at(birth, applied),
            "lng": lng,
            "lat": lat,
            "好人好事": bool(deeds),
            "好人好事数": good_deeds_count(deeds),
            "好人好事摘要": re.sub(r"\s+", " ", deeds)[:90],
            "好人好事全文": deeds,
            "会费到期": fee_due.isoformat() if fee_due else "",
            "会费状态": fee_status(fee_due),
            "会费剩余天": (fee_due - TODAY).days if fee_due else None,
            "企业标签": tags,
            "注册资金": num_or_none(cell(row, "注册资金（万元）")),
            "总资产": num_or_none(cell(row, "总资产（万元）")),
            "员工数": num_or_none(cell(row, "员工数（人）")),
            "纳税额": num_or_none(cell(row, "最近一年纳税额")),
            "考核总分": assess.get("考核总分"),
            "考核常规分": assess.get("考核常规分"),
            "考核活动分": assess.get("考核活动分"),
            "考核赞助分": assess.get("考核赞助分"),
            "考核好事分": assess.get("考核好事分"),
            "考核品行": assess.get("考核品行", ""),
            "活动次数": (
                (assess.get("考核常规次数") or 0) + (assess.get("考核加分次数") or 0)
                if assess.get("考核常规次数") is not None or assess.get("考核加分次数") is not None else None
            ),
        })

    # 保持 Excel 原始顺序（按序号），页面默认即按此顺序展示
    members.sort(key=lambda m: m["序号"])

    payload = {
        "meta": {
            "生成时间": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "数据源": INPUT_XLSX.name,
            "工作表": sheet_name,
            "会员数": len(members),
            "考核覆盖": sum(1 for m in members if m.get("考核总分") is not None),
            "统计截止": TODAY.isoformat(),
        },
        "members": members,
    }
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"已生成 {OUTPUT_JSON.name}：{len(members)} 条会员数据")


if __name__ == "__main__":
    main()
