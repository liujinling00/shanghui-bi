# 发布与访问说明

## 两个版本

| 版本 | 目录 | 含什么 | 给谁 |
| --- | --- | --- | --- |
| 公开版 | `shanghui-bi-public/` | 会员名录、地图、结构、行业、年龄、趋势、会龄、生日、公益、到龄、企业资质标签 | 全体会员，挂公网 |
| 内部版 | `shanghui-bi/` | 公开版全部 + 会费状态、年度考核、活动次数、企业财务 + 内部模式名单 | 理事会 / 秘书处 |

公开版由脚本生成：

```powershell
python scripts/build_public.py
```

它会把 `../shanghui-bi-public/` 整个重建一遍，自动去掉 16 个敏感字段（会费到期/状态、考核各分项、活动次数、注册资金/总资产/员工数/纳税额），并**不复制** `商会BI数据.xlsx`、`legacy_coords.json`、`scripts/`、说明文档。

### 关于 Excel 数据源

新版已经把 `data/商会BI数据.xlsx` 从目录里移除，并加了 `.gitignore`（`data/*.xlsx`）。Excel 只留在你电脑上，脚本运行时用路径传入：

```powershell
python scripts/refresh_data.py "D:\360MoveData\Users\Admin\Desktop\商会分布地图（261111）.xlsx"
```

如果旧仓库里还留着这个文件（里面有电话、生日、身份证），建议清掉：

```powershell
git rm --cached data/商会BI数据.xlsx
git commit -m "移除含隐私的 Excel 数据源" && git push
```

> ⚠️ 注意：`git rm --cached` 只是不再跟踪，历史提交里仍有。彻底清除需要对历史做 `git filter-repo`，或直接把仓库设为私有。


站点是纯静态页面（HTML + JS + JSON + 图片），不需要服务器、数据库，任何静态托管都能跑。

---

## 方式一：GitHub Pages（推荐，和你现在的站点一致）

你现在的地址是 `https://liujinling00.github.io/shanghui-bi/`，仓库结构和新版完全一样，覆盖即可。

```powershell
# 1. 解压新版压缩包，进入目录
cd 解压后的目录

# 2. 覆盖到本地仓库（假设仓库已 clone 在 D:\shanghui-bi）
Copy-Item index.html,assets,data,scripts -Destination D:\shanghui-bi -Recurse -Force

# 3. 提交并推送
cd D:\shanghui-bi
git add -A
git commit -m "新版智慧看板：会费/考核/企业画像 + 移动端适配"
git push
```

推送后 1–2 分钟生效，手机和电脑打开同一个地址即可。
（也可以直接在 GitHub 网页上传文件，效果一样。）

## 方式二：Netlify Drop（不用装任何工具，拖一下就发布）

1. 浏览器打开 <https://app.netlify.com/drop>
2. 把整个 `shanghui-bi` 文件夹拖进去
3. 几秒后得到一个 `https://xxxx.netlify.app` 的地址，可直接发给会员
4. 注册后可以改名（如 `shanghui-bi.netlify.app`）并绑定自己的域名

优点：不用命令行；缺点：和 GitHub 是两套地址，以后更新要重新拖一次。

## 方式三：局域网（会议现场最快）

```powershell
cd 站点目录
python -m http.server 8848 --bind 0.0.0.0
```

同一 Wi-Fi 下，手机浏览器打开 `http://电脑的局域网IP:8848` 即可（当前电脑是 `192.168.110.106`）。
只适合现场演示，离开这个网络就打不开了。

## 方式四：临时公网地址（本机开机期间有效）

用 SSH 隧道把本机 8848 端口映射到公网：

```powershell
ssh -R 80:127.0.0.1:8848 nokey@localhost.run
```

终端会打印一个 `https://xxxx.lhr.life` 地址，手机可直接打开。
缺点是**电脑关机/断网就失效，域名也会轮换**，不适合正式对外。

---

## 把仓库设为 Private 之前，务必先看这条

GitHub 官方规则：**GitHub Free 只能在公开仓库上发布 Pages**；私有仓库要用 Pages，需要 Pro / Team / Enterprise（见 [官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)）。

也就是说：

| 你的账号 | 设为 Private 后 |
| --- | --- |
| GitHub Free（免费） | 现有 Pages 站点会**停止发布**，旧地址 404 |
| GitHub Pro（$4/月） | 站点继续可用，仓库变私有 |

另外要清楚：**私有仓库 ≠ 网站私有**。Pages 站点本身仍然是公开可访问的（企业版才能做访问控制）。对"发给会员看"这个需求来说没问题，只是别误以为链接会变私密。

### 三条可选路线

1. **升 Pro，然后设为 Private**（最省事）
   Settings → Billing 升级 Pro → Settings → General → Danger Zone → Change visibility → Make private；
   Pages 不受影响。
2. **保持 Free、仓库设 Private，改用 Netlify 托管**（免费）
   仓库可以私有，Netlify 免费版支持私有仓库：Netlify → Add new site → Import from Git → 选仓库 →
   publish directory 填 `.`（项目里已带 `netlify.toml`），Build command 留空。
3. **仓库继续公开，只把 Excel 从历史里清掉**
   `git filter-repo --path data/商会BI数据.xlsx --invert-paths`（需先装 `git-filter-repo`），
   然后强制推送。站点完全不受影响，但历史里其它提交仍公开。

> 无论选哪种，`data/商会BI数据.xlsx` 的历史版本都不会自动消失；设 Private 只是让外人看不到。

## 彻底清除历史：删库重建（免费账号、地址不变）

不升级、不换托管，把带 Excel 的旧仓库整体删掉，用干净文件重建同名仓库，地址和以前一模一样。

> 原理：项目站点地址由「账号名 + 仓库名」决定，同名重建后 URL 不变（`https://liujinling00.github.io/shanghui-bi/`）。
> 前提：仓库里没有你在意的 Issues / Star / Actions（这个项目本来也没有）。

**步骤（全程网页操作，不用装 git）**

1. 先把 **公开版** 解压到桌面，确认里面有 `index.html`、`assets/`、`data/`。
2. GitHub 打开旧仓库 → **Settings** → 拉到最底 **Danger Zone** → **Delete this repository** → 输入仓库名确认。
3. 回到 GitHub 首页 → **New repository** → 名字必须还是 `shanghui-bi` → 选 **Public** → 不要勾 README → Create。
4. 在新仓库页点 **uploading an existing file**，把解压出来的**文件夹内容**（不是文件夹本身）全选拖进去 → Commit。
5. **Settings → Pages** → Source 选 `Deploy from a branch` → Branch 选 `main` + `/ (root)` → Save。
6. 等 1–2 分钟，打开 `https://liujinling00.github.io/shanghui-bi/`，Ctrl+F5 强制刷新。

> 旧仓库删除后有 90 天恢复窗口，但对外已经 404，别人拿不到历史里的 Excel。
> 你桌面上的 Excel 原件不受影响，以后更新数据照常用。

## 手机端说明

- 页面已做移动端适配（筛选器换行、指标两列、地图与图表自适应）。
- iPhone Safari / 安卓 Chrome 都可以「添加到主屏幕」，用起来像 App。
- 图表是 Canvas 渲染，iOS 15.4+、安卓 Chrome 100+ 均正常。

## 数据更新

1. 改 `data/商会BI数据.xlsx`（会员总表 / 考核明细表）；
2. 运行 `python scripts/refresh_data.py`；
3. 重新发布 `data/members.json`（GitHub 推送或 Netlify 重传）。

## 关于隐私与「内部模式」

`data/members.json` 是公开文件，任何人都能直接下载。当前版本里包含每位会员的：

- 会费状态与到期日
- 年度考核总分、活动次数
- 年龄、区域、单位（原本就在旧版公开页面上）

`内部模式` 只是**界面开关**，不等于权限控制。如果要发给全体会员，建议：

- **公开版**：去掉会费、考核、活动次数等按人数据（卡片只保留汇总图），用于会员端；
- **内部版**：保留全部数据，只给理事会/秘书处，放在内网或本地打开。

需要我出一版「公开版」的话，说一声即可，脚本会自动裁掉敏感字段。
