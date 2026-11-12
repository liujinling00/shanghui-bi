# -*- coding: utf-8 -*-
"""
生成「公开版」站点目录：去掉会费、考核、活动次数、企业财务等按人/按企业的敏感字段。

用法：python scripts/build_public.py
输出：../shanghui-bi-public/  （可直接上传到 GitHub Pages / Netlify）

内部版仍然是当前目录（含全部数据），两者互不影响。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "shanghui-bi-public"

SENSITIVE = (
    "会费到期", "会费状态", "会费剩余天",
    "考核总分", "考核常规分", "考核活动分", "考核赞助分", "考核好事分",
    "考核品行", "考核常规次数", "考核加分次数", "活动次数",
    "注册资金", "总资产", "员工数", "纳税额",
    "生日月",
)

IGNORE = shutil.ignore_patterns(
    "*.xlsx", "*.ps1", "README.md", "DEPLOY.md",
    "legacy_coords.json", "scripts", "__pycache__",
)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT, OUT, ignore=IGNORE)

    src = ROOT / "data" / "members.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    members = data.get("members", [])

    cleaned = []
    for m in members:
        cleaned.append({k: v for k, v in m.items() if k not in SENSITIVE})

    meta = data.get("meta", {})
    meta["版本"] = "public"
    meta.pop("考核覆盖", None)
    meta["说明"] = "公开版：不含会费、考核、活动次数、生日月份与企业财务数据"

    payload = {"meta": meta, "members": cleaned}
    (OUT / "data" / "members.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    left = sorted({k for m in cleaned for k in m if k in SENSITIVE})
    print(f"公开版已生成：{OUT}")
    print(f"会员 {len(cleaned)} 人；已移除字段 {len(SENSITIVE)} 个" + (f"（残留：{left}）" if left else ""))


if __name__ == "__main__":
    main()
