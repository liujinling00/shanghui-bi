/* ==========================================================================
   商会 BI · 交互与图表
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

  /* ------------------------------------------------------------ 视觉规范 */
  const POS = [
    { key: '会长', color: '#F0C987' },
    { key: '副会长', color: '#7FB3FF' },
    { key: '理事', color: '#5DE3D2' },
    { key: '会员', color: '#93A7C4' },
    { key: '其他', color: '#A78BFA' }
  ];
  const POS_COLOR = Object.fromEntries(POS.map((p) => [p.key, p.color]));

  const POL_COLOR = {
    '中共党员': '#FF8A7A',
    '民主党派': '#F0C987',
    '无党派人士': '#A78BFA',
    '共青团员': '#5DE3D2',
    '群众': '#7E93B3',
    '未登记': '#4A5C78'
  };
  const POL_ORDER = ['中共党员', '民主党派', '无党派人士', '共青团员', '群众'];

  const INK = { t1: '#EEF4FF', t2: '#A9BCD8', t3: '#6B7F9E', t4: '#475A76', line: 'rgba(142,172,222,0.09)' };

  const TT = {
    backgroundColor: 'rgba(9,15,26,0.95)',
    borderColor: 'rgba(142,172,222,0.22)',
    borderWidth: 1,
    padding: [9, 13],
    textStyle: { color: '#DCE7F8', fontSize: 12 },
    extraCssText: 'backdrop-filter:blur(14px);border-radius:11px;box-shadow:0 24px 48px -24px #000;'
  };

  const AXIS_LABEL = { color: INK.t3, fontSize: 10.5, fontFamily: 'Bahnschrift, PingFang SC, sans-serif' };
  const SPLIT = { lineStyle: { color: INK.line, type: [4, 4] } };

  /* ------------------------------------------------------------ 状态 */
  const state = {
    all: [],
    meta: {},
    view: 'city',
    industryView: 'category',
    trendView: 'year',
    internal: false,
    assessView: 'score',
    filters: { position: '全部', industry: '全部', district: '全部', year: '全部', gender: 'all' },
    search: '',
    sort: { key: '序号', dir: 1 },
    page: 1,
    pageSize: 10,
    hiddenPos: new Set(),
    custom: []
  };

  const charts = {};
  let filtered = [];
  const isPublic = () => !!(state.meta && state.meta['版本'] === 'public');

  /* ------------------------------------------------------------ 工具 */
  function countBy(list, key) {
    const m = new Map();
    list.forEach((it) => {
      const k = it[key] == null || it[key] === '' ? '未登记' : it[key];
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }

  function sortedEntries(map, order) {
    const arr = Array.from(map.entries());
    if (order) {
      arr.sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b[1] - a[1];
      });
    } else {
      arr.sort((a, b) => b[1] - a[1]);
    }
    return arr;
  }

  const INDUSTRY_SHORT = {
    '科学研究和技术服务业': '科学研究',
    '批发和零售业': '批发零售',
    '租赁和商务服务业': '租赁商务',
    '住宿和餐饮业': '住宿餐饮',
    '信息传输、软件和信息技术服务业': '信息软件',
    '文化、体育和娱乐业': '文体娱乐',
    '居民服务、修理和其他服务业': '居民服务',
    '水利、环境和公共设施管理业': '水利环境',
    '交通运输、仓储和邮政业': '交通物流',
    '卫生和社会工作': '卫生社工',
    '农、林、牧、渔业': '农林牧渔',
    '电力、热力、燃气及水生产和供应业': '电力热力',
    '商业服务': '商业服务',
    '民办非企业单位': '民非单位',
    '未登记': '未登记'
  };

  function shortIndustry(s) {
    return INDUSTRY_SHORT[s] || (s.length > 6 ? s.slice(0, 6) : s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const STATIC_MODE = new URLSearchParams(location.search).get('static') === '1';

  function animateNum(el, to, decimals) {
    if (!el) return;
    if (STATIC_MODE) {
      el.textContent = decimals ? Number(to || 0).toFixed(decimals) : fmt(to);
      el.dataset.val = to;
      return;
    }
    const from = parseFloat(el.dataset.val || '0');
    const target = Number(to) || 0;
    if (Math.abs(target - from) < 0.001) {
      el.textContent = decimals ? target.toFixed(decimals) : fmt(target);
      el.dataset.val = target;
      return;
    }
    const dur = 780;
    const t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * e;
      el.textContent = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('zh-CN');
      if (p < 1) requestAnimationFrame(step);
      else el.dataset.val = target;
    }
    requestAnimationFrame(step);
  }

  function setBar(el, ratio) {
    if (!el) return;
    el.style.width = Math.max(0, Math.min(100, ratio * 100)) + '%';
  }

  /* ------------------------------------------------------------ 数据 */
  async function loadData(isRefresh) {
    const btn = $('#refreshBtn');
    if (isRefresh) btn.classList.add('spin');
    try {
      const res = await fetch('data/members.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      state.all = Array.isArray(json) ? json : json.members || [];
      state.meta = json.meta || {};
      if (!state.all.length) throw new Error('数据为空');
      boot();
    } catch (err) {
      console.error(err);
      toast('数据载入失败：' + err.message);
    } finally {
      btn.classList.remove('spin');
    }
  }

  function toast(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:200;padding:11px 18px;border-radius:12px;font-size:12.5px;color:#ffd9d4;background:rgba(60,18,18,.9);border:1px solid rgba(255,122,107,.35);backdrop-filter:blur(10px);box-shadow:0 20px 40px -20px #000';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 4200);
  }

  /* ------------------------------------------------------------ 筛选 */
  function optionsFor(key) {
    if (key === 'position') return POS.map((p) => p.key).filter((k) => state.all.some((m) => m.职位归类 === k));
    if (key === 'industry') return sortedEntries(countBy(state.all, '所属行业')).map((e) => e[0]);
    if (key === 'district') {
      return sortedEntries(countBy(state.all, '区域'))
        .filter((e) => e[0] !== '其他')
        .map((e) => e[0])
        .concat(state.all.some((m) => m.区域 === '其他') ? ['其他'] : []);
    }
    if (key === 'year') {
      return Array.from(new Set(state.all.map((m) => m.申请年份).filter(Boolean))).sort((a, b) => b - a).map(String);
    }
    return [];
  }

  function labelFor(key) {
    return { position: '职位', industry: '行业', district: '区域', year: '入会' }[key] || key;
  }

  function buildDropdowns() {
    $$('.dd').forEach((dd) => {
      const key = dd.dataset.key;
      const panel = $('.dd-panel', dd);
      const btnV = $('.dd-btn .v', dd);
      const opts = optionsFor(key);
      const counts = countBy(state.all, key === 'position' ? '职位归类' : key === 'industry' ? '所属行业' : key === 'district' ? '区域' : '申请年份');

      panel.innerHTML = ['全部'].concat(opts).map((v) => {
        const n = v === '全部' ? state.all.length : counts.get(key === 'year' ? Number(v) : v) || 0;
        const sel = state.filters[key] === v ? ' sel' : '';
        return '<div class="dd-item' + sel + '" data-v="' + esc(v) + '"><span>' + esc(v) + '</span><span class="n">' + n + '</span></div>';
      }).join('');

      const sync = () => {
        const cur = state.filters[key];
        btnV.textContent = cur;
        dd.classList.toggle('on', cur !== '全部');
        $$('.dd-item', panel).forEach((it) => it.classList.toggle('sel', it.dataset.v === cur));
      };

      $('.dd-btn', dd).onclick = (e) => {
        e.stopPropagation();
        const open = dd.classList.contains('open');
        $$('.dd').forEach((d) => d.classList.remove('open'));
        if (!open) dd.classList.add('open');
      };
      panel.onclick = (e) => {
        const it = e.target.closest('.dd-item');
        if (!it) return;
        state.filters[key] = it.dataset.v;
        state.page = 1;
        sync();
        dd.classList.remove('open');
        render();
      };
      sync();
    });

    document.addEventListener('click', () => $$('.dd').forEach((d) => d.classList.remove('open')));

    $$('#segGender button').forEach((b) => {
      b.onclick = () => {
        $$('#segGender button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        state.filters.gender = b.dataset.v;
        state.page = 1;
        render();
      };
    });

    let timer;
    $('#gSearch').oninput = (e) => {
      clearTimeout(timer);
      const v = e.target.value.trim();
      timer = setTimeout(() => { state.search = v; state.page = 1; render(); }, 180);
    };
  }

  function computeFiltered() {
    const f = state.filters;
    const q = state.search.toLowerCase();
    filtered = state.all.filter((m) => {
      if (f.position !== '全部' && m.职位归类 !== f.position) return false;
      if (f.industry !== '全部' && m.所属行业 !== f.industry) return false;
      if (f.district !== '全部' && m.区域 !== f.district) return false;
      if (f.year !== '全部' && String(m.申请年份) !== f.year) return false;
      if (f.gender !== 'all' && m.性别 !== f.gender) return false;
      if (q) {
        const hay = (m.会员姓名 + m.单位名称 + m.所属行业 + m.区域 + m.政治面貌 + m.会内职位).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------------------ KPI */
  function renderKPI() {
    const n = filtered.length;
    const total = state.all.length;
    const male = filtered.filter((m) => m.性别 === '男').length;
    const female = n - male;
    const pub = isPublic();
    const feeValid = pub ? 0 : filtered.filter((m) => m.会费状态 === '有效').length;
    const feeExpired = pub ? 0 : filtered.filter((m) => m.会费状态 === '已到期').length;
    const party = filtered.filter((m) => m.政治面貌归类 === '中共党员').length;
    const leaders = filtered.filter((m) => m.理事会).length;
    const deeds = filtered.filter((m) => m.好人好事).length;
    const deedItems = filtered.reduce((a, m) => a + (m.好人好事数 || 0), 0);

    animateNum($('#kpiTotal .kpi-num'), n);
    if (pub) {
      const ages = filtered.map((m) => m.年龄).filter((v) => typeof v === 'number' && v > 0);
      const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
      const sorted = ages.slice().sort((a, b) => a - b);
      animateNum($('#kFee'), avgAge, 1);
      const card = $('#kFee').closest('.kpi');
      $('.kpi-label', card).textContent = '平均年龄';
      $('.kpi-unit', card).textContent = '岁';
      $('.kpi-note', card).innerHTML = '中位 <b>' + (sorted[Math.floor(sorted.length / 2)] || '—') + '</b> 岁 · 最年轻 <b>' + (sorted[0] || '—') + '</b> 岁';
      const meter = $('.meter', card);
      if (meter) meter.style.display = 'none';
    } else {
      animateNum($('#kFee'), feeValid);
    }
    animateNum($('#kFemale'), female);
    animateNum($('#kParty'), party);
    animateNum($('#kLeader'), leaders);
    animateNum($('#kDeed'), deeds);

    $('#pctFemale').textContent = pct(female, n);
    $('#pctParty').textContent = pct(party, n);
    $('#pctLeader').textContent = pct(leaders, n);
    $('#deedItems').textContent = fmt(deedItems);
    setBar($('#barFemale'), n ? female / n : 0);
    setBar($('#barParty'), n ? party / n : 0);
    setBar($('#barLeader'), n ? leaders / n : 0);
    setBar($('#barDeed'), n ? deeds / n : 0);

    const districts = new Set(filtered.map((m) => m.区域).filter((d) => d && d !== '其他')).size;
    $('#noteTotal').innerHTML = '覆盖 <b>' + districts + '</b> 个区县 · 会员企业 <b>' + n + '</b> 家';
    if (!pub) {
      $('#feeExpired').textContent = feeExpired + ' 人';
      $('#pctFee').textContent = pct(feeValid, n);
      setBar($('#barFee'), n ? feeValid / n : 0);
    }

    // 自定义指标
    $$('.kpi.custom-card').forEach((card) => {
      const field = card.dataset.field;
      const value = card.dataset.value;
      const c = filtered.filter((m) => String(m[field]) === value).length;
      const numEl = $('.kpi-num', card);
      animateNum(numEl, c);
      $('.kpi-note', card).innerHTML = esc(value) + ' · 占 <b>' + pct(c, n) + '</b>';
    });
  }

  /* ------------------------------------------------------------ 图表通用 */
  function getChart(id) {
    if (typeof echarts === 'undefined') return null;
    const el = document.getElementById(id);
    if (!el) return null;
    if (!charts[id]) {
      charts[id] = echarts.init(el, null, { renderer: 'canvas' });
    }
    return charts[id];
  }

  const EMPTY = {
    title: {
      text: '暂无匹配数据',
      left: 'center',
      top: 'middle',
      textStyle: { color: INK.t4, fontSize: 12, fontWeight: 400 }
    }
  };

  /* ------------------------------------------------------------ 行业 */
  function renderIndustry() {
    const c = getChart('chartIndustry');
    if (!c) return;
    const isSub = state.industryView === 'sub';
    const key = isSub ? '细分行业' : '所属行业';
    const all = sortedEntries(countBy(filtered, key)).filter((e) => e[0] !== '未登记' && e[0]);
    const entries = all.slice(0, isSub ? 10 : 8).reverse();
    if (!entries.length) { c.setOption(EMPTY, true); $('#industryHint').textContent = ''; return; }
    const max = Math.max.apply(null, entries.map((e) => e[1]));
    const cr3 = all.slice(0, 3).reduce((a2, e) => a2 + e[1], 0);
    $('#industryHint').textContent = isSub
      ? '共 ' + all.length + ' 个细分'
      : '前三占 ' + pct(cr3, filtered.length);

    c.setOption({
      animationDuration: 900,
      grid: { left: 6, right: 42, top: 8, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => {
          const it = p[0];
          return '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + esc(it.name) + '</div>' +
            '<b style="font-size:15px;color:#EEF4FF">' + it.value + '</b> 人 · ' + pct(it.value, filtered.length);
        }
      }),
      xAxis: { type: 'value', max: max * 1.15, show: false },
      yAxis: {
        type: 'category',
        data: entries.map((e) => e[0]),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, {
          color: INK.t2,
          fontSize: isSub ? 10 : 10.5,
          width: 150,
          overflow: 'truncate',
          formatter: (v) => (v.length > 11 ? v.slice(0, 10) + '…' : v)
        })
      },
      series: [
        {
          type: 'bar',
          data: entries.map((e) => e[1]),
          barWidth: isSub ? 7 : 9,
          showBackground: true,
          backgroundStyle: { color: 'rgba(255,255,255,0.035)', borderRadius: 5 },
          itemStyle: {
            borderRadius: 5,
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: 'rgba(93,227,210,0.25)' },
              { offset: 0.55, color: 'rgba(111,168,255,0.75)' },
              { offset: 1, color: '#9CC6FF' }
            ]),
            shadowBlur: 12,
            shadowColor: 'rgba(111,168,255,0.35)'
          },
          label: {
            show: true,
            position: 'right',
            distance: 7,
            color: INK.t2,
            fontSize: isSub ? 10 : 11,
            fontFamily: 'Bahnschrift, sans-serif',
            formatter: '{c}'
          }
        }
      ]
    }, true);
  }

  /* ------------------------------------------------------------ 年龄 */
  function renderAge() {
    const c = getChart('chartAge');
    if (!c) return;
    const bins = ['<25', '25-29', '30-34', '35-39', '40-44', '45+'];
    const counts = bins.map(() => 0);
    const ages = [];
    filtered.forEach((m) => {
      const a = m.年龄;
      if (typeof a !== 'number' || a <= 0) return;
      ages.push(a);
      if (a < 25) counts[0]++;
      else if (a < 30) counts[1]++;
      else if (a < 35) counts[2]++;
      else if (a < 40) counts[3]++;
      else if (a < 45) counts[4]++;
      else counts[5]++;
    });
    if (!ages.length) { c.setOption(EMPTY, true); return; }
    const avg = ages.reduce((x, y) => x + y, 0) / ages.length;

    c.setOption({
      animationDuration: 900,
      grid: { left: 4, right: 10, top: 34, bottom: 2, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => {
          const it = p[0];
          return '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + it.name + ' 岁</div><b style="font-size:15px;color:#EEF4FF">' + it.value + '</b> 人 · ' + pct(it.value, ages.length);
        }
      }),
      xAxis: {
        type: 'category',
        data: bins,
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: AXIS_LABEL
      },
      yAxis: { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL },
      series: [{
        type: 'bar',
        data: counts,
        barWidth: '46%',
        itemStyle: {
          borderRadius: [5, 5, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#7FB3FF' },
            { offset: 1, color: 'rgba(111,168,255,0.10)' }
          ])
        },
        emphasis: { itemStyle: { color: '#A9C9FF' } },
        label: { show: true, position: 'top', color: INK.t2, fontSize: 10.5, fontFamily: 'Bahnschrift, sans-serif' }
      }],
      graphic: [{
        type: 'text',
        right: 2,
        top: 0,
        style: { text: '平均 ' + avg.toFixed(1) + ' 岁', fill: '#F0C987', font: '11px Bahnschrift, PingFang SC, sans-serif' }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 政治面貌 */
  function renderPolitical() {
    const c = getChart('chartPolitical');
    if (!c) return;
    const map = countBy(filtered, '政治面貌归类');
    const entries = POL_ORDER.filter((k) => map.get(k)).map((k) => [k, map.get(k)]);
    if (!entries.length) { c.setOption(EMPTY, true); return; }

    c.setOption({
      animationDuration: 900,
      tooltip: Object.assign({}, TT, {
        trigger: 'item',
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p.name + '</div><b style="font-size:15px;color:#EEF4FF">' + p.value + '</b> 人 · ' + p.percent + '%'
      }),
      series: [{
        type: 'pie',
        radius: ['56%', '76%'],
        center: ['50%', '48%'],
        avoidLabelOverlap: true,
        padAngle: 3,
        itemStyle: { borderRadius: 6, borderColor: 'rgba(6,10,18,0.9)', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0,0,0,0.6)' } },
        data: entries.map((e) => ({
          name: e[0],
          value: e[1],
          itemStyle: { color: POL_COLOR[e[0]] || '#7E93B3' }
        }))
      }],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '43%',
          style: {
            text: String(filtered.length),
            fill: '#EEF4FF',
            font: '600 26px Bahnschrift, sans-serif',
            textAlign: 'center'
          }
        },
        {
          type: 'text',
          left: 'center',
          top: '55%',
          style: { text: '会员总数', fill: '#6B7F9E', font: '10px sans-serif', textAlign: 'center' }
        }
      ]
    }, true);

    $('#polLegend').innerHTML = entries.map((e) =>
      '<span class="chip"><i style="background:' + (POL_COLOR[e[0]] || '#7E93B3') + '"></i>' + esc(e[0]) + ' <b>' + e[1] + '</b></span>'
    ).join('');
  }

  /* ------------------------------------------------------------ 职位 */
  function renderPosition() {
    const c = getChart('chartPosition');
    if (!c) return;
    const map = countBy(filtered, '职位归类');
    const entries = POS.filter((p) => map.get(p.key)).map((p) => [p.key, map.get(p.key)]);
    if (!entries.length) { c.setOption(EMPTY, true); $('#posLegend').innerHTML = ''; return; }

    c.setOption({
      animationDuration: 900,
      tooltip: Object.assign({}, TT, {
        trigger: 'item',
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p.name + '</div><b style="font-size:15px;color:#EEF4FF">' + p.value + '</b> 人 · ' + p.percent + '%'
      }),
      series: [{
        type: 'pie',
        radius: ['64%', '86%'],
        center: ['50%', '50%'],
        padAngle: 4,
        itemStyle: { borderRadius: 4, borderColor: 'rgba(6,10,18,0.9)', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 5 },
        data: entries.map((e) => ({ name: e[0], value: e[1], itemStyle: { color: POS_COLOR[e[0]] } }))
      }],
      graphic: [
        { type: 'text', left: 'center', top: '42%', style: { text: String(filtered.length), fill: '#EEF4FF', font: '600 24px Bahnschrift, sans-serif', textAlign: 'center' } },
        { type: 'text', left: 'center', top: '54%', style: { text: '在册会员', fill: '#6B7F9E', font: '10px sans-serif', textAlign: 'center' } }
      ]
    }, true);

    $('#posLegend').innerHTML = entries.map((e) =>
      '<div class="legend-row"><span class="dot" style="background:' + POS_COLOR[e[0]] + ';box-shadow:0 0 8px ' + POS_COLOR[e[0]] + '88"></span>' +
      '<span class="nm">' + esc(e[0]) + '</span><span class="ct">' + e[1] + '</span><span class="pc">' + pct(e[1], filtered.length) + '</span></div>'
    ).join('');
  }

  /* ------------------------------------------------------------ 性别 */
  function renderGender() {
    const male = filtered.filter((m) => m.性别 === '男').length;
    const female = filtered.filter((m) => m.性别 === '女').length;
    const total = male + female || 1;
    $('#barMale').style.width = (male / total) * 100 + '%';
    $('#barFemaleSeg').style.width = (female / total) * 100 + '%';
    $('#txtMale').textContent = male + ' 人 · ' + pct(male, total);
    $('#txtFemale').textContent = female + ' 人 · ' + pct(female, total);
    $('#genderRatio').textContent = '男 ' + pct(male, total) + ' / 女 ' + pct(female, total);
  }

  /* ------------------------------------------------------------ 趋势 */
  function renderTrend() {
    const c = getChart('chartTrend');
    if (!c) return;
    const years = Array.from(new Set(filtered.map((m) => m.申请年份).filter(Boolean))).sort((x, y) => x - y);
    if (!years.length) { c.setOption(EMPTY, true); return; }
    const span = [];
    for (let y = Math.min.apply(null, years); y <= Math.max.apply(null, years); y++) span.push(y);

    if (state.trendView === 'age') {
      const avg = span.map((y) => {
        const list = filtered.filter((m) => m.申请年份 === y && typeof m['入会年龄'] === 'number');
        return list.length ? Math.round((list.reduce((a2, m) => a2 + m['入会年龄'], 0) / list.length) * 10) / 10 : null;
      });
      const all = filtered.filter((m) => typeof m['入会年龄'] === 'number');
      const overall = all.length ? all.reduce((a2, m) => a2 + m['入会年龄'], 0) / all.length : 0;

      c.setOption({
        animationDuration: 1000,
        grid: { left: 4, right: 12, top: 30, bottom: 4, containLabel: true },
        tooltip: Object.assign({}, TT, {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: 'rgba(111,168,255,0.35)', type: [4, 4] } },
          formatter: (ps) => {
            const it = ps[0];
            const n = filtered.filter((m) => m.申请年份 === Number(it.name)).length;
            return '<div style="color:#8FA6C8;font-size:11px;margin-bottom:6px">' + it.name + ' 年入会</div>' +
              '<div style="display:flex;justify-content:space-between;gap:18px"><span>当年人数</span><b style="color:#A9C9FF">' + n + '</b></div>' +
              '<div style="display:flex;justify-content:space-between;gap:18px;margin-top:2px"><span>平均入会年龄</span><b style="color:#F0C987">' + (it.value == null ? '—' : it.value) + ' 岁</b></div>';
          }
        }),
        xAxis: {
          type: 'category', data: span.map(String), boundaryGap: false,
          axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
          axisTick: { show: false },
          axisLabel: AXIS_LABEL
        },
        yAxis: {
          type: 'value', scale: true,
          splitLine: SPLIT, axisLabel: AXIS_LABEL,
          min: (v) => Math.floor(v.min - 1), max: (v) => Math.ceil(v.max + 1)
        },
        series: [{
          name: '平均入会年龄',
          type: 'line',
          data: avg,
          smooth: 0.4,
          symbol: 'circle',
          symbolSize: 7,
          connectNulls: true,
          lineStyle: { width: 2, color: '#F0C987', shadowBlur: 14, shadowColor: 'rgba(240,201,135,0.5)' },
          itemStyle: { color: '#F0C987', borderColor: 'rgba(6,12,22,0.9)', borderWidth: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(240,201,135,0.22)' },
              { offset: 1, color: 'rgba(240,201,135,0)' }
            ])
          },
          label: { show: true, position: 'top', color: '#F3D29A', fontSize: 10, fontFamily: 'Bahnschrift, sans-serif' },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { color: 'rgba(169,201,255,0.5)', type: [5, 5], width: 1 },
            label: { formatter: '整体 ' + overall.toFixed(1) + ' 岁', color: '#A9C9FF', fontSize: 10, position: 'insideStartTop', padding: [0, 0, 4, 6] },
            data: [{ yAxis: Math.round(overall * 10) / 10 }]
          }
        }]
      }, true);
      return;
    }

    const per = span.map((y) => filtered.filter((m) => m.申请年份 === y).length);
    let acc = 0;
    const cum = per.map((v) => (acc += v));

    c.setOption({
      animationDuration: 1000,
      grid: { left: 4, right: 8, top: 30, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(111,168,255,0.35)', type: [4, 4] } },
        formatter: (ps) => {
          const y = ps[0].name;
          const nw = ps.find((p) => p.seriesName === '年度新增');
          const cu = ps.find((p) => p.seriesName === '累计会员');
          return '<div style="color:#8FA6C8;font-size:11px;margin-bottom:6px">' + y + ' 年</div>' +
            '<div style="display:flex;justify-content:space-between;gap:18px"><span>新增</span><b style="color:#A9C9FF">' + nw.value + '</b></div>' +
            '<div style="display:flex;justify-content:space-between;gap:18px;margin-top:2px"><span>累计</span><b style="color:#5DE3D2">' + cu.value + '</b></div>';
        }
      }),
      legend: {
        top: 0, right: 4, itemWidth: 10, itemHeight: 6, itemGap: 16, icon: 'roundRect',
        textStyle: { color: INK.t3, fontSize: 10.5 },
        data: ['年度新增', '累计会员']
      },
      xAxis: {
        type: 'category',
        data: span.map(String),
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: AXIS_LABEL
      },
      yAxis: [
        { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL, minInterval: 1 },
        { type: 'value', splitLine: { show: false }, axisLabel: AXIS_LABEL, minInterval: 1 }
      ],
      series: [
        {
          name: '年度新增',
          type: 'bar',
          barWidth: '34%',
          data: per,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(169,201,255,0.95)' },
              { offset: 1, color: 'rgba(111,168,255,0.12)' }
            ])
          },
          emphasis: { itemStyle: { color: '#D6E6FF' } }
        },
        {
          name: '累计会员',
          type: 'line',
          yAxisIndex: 1,
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          data: cum,
          lineStyle: { width: 2, color: '#5DE3D2', shadowBlur: 14, shadowColor: 'rgba(93,227,210,0.55)' },
          itemStyle: { color: '#5DE3D2', borderColor: 'rgba(6,12,22,0.9)', borderWidth: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(93,227,210,0.26)' },
              { offset: 1, color: 'rgba(93,227,210,0)' }
            ])
          }
        }
      ]
    }, true);
  }

  /* ------------------------------------------------------------ 热力 */
  function renderHeat() {
    const c = getChart('chartHeat');
    if (!c) return;
    const industries = sortedEntries(countBy(filtered, '所属行业')).slice(0, 6).map((e) => e[0]);
    const districts = sortedEntries(countBy(filtered, '区域')).filter((e) => e[0] !== '其他').slice(0, 7).map((e) => e[0]);
    if (!industries.length || !districts.length) { c.setOption(EMPTY, true); return; }

    const data = [];
    let max = 0;
    districts.forEach((d, xi) => {
      industries.forEach((ind, yi) => {
        const v = filtered.filter((m) => m.区域 === d && m.所属行业 === ind).length;
        max = Math.max(max, v);
        data.push([xi, yi, v]);
      });
    });

    c.setOption({
      animationDuration: 800,
      grid: { left: 4, right: 12, top: 10, bottom: 44, containLabel: true },
      tooltip: Object.assign({}, TT, {
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + districts[p.value[0]] + ' · ' + esc(industries[p.value[1]]) + '</div><b style="font-size:15px;color:#EEF4FF">' + p.value[2] + '</b> 人'
      }),
      xAxis: {
        type: 'category',
        data: districts,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, {
          interval: 0,
          formatter: (v) => String(v).replace(/区$|县$|市$/, ''),
          fontSize: 10
        })
      },
      yAxis: {
        type: 'category',
        data: industries.map(shortIndustry),
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, { fontSize: 10, color: INK.t2 })
      },
      visualMap: {
        min: 0,
        max: Math.max(3, max),
        show: false,
        inRange: { color: ['rgba(111,168,255,0.05)', 'rgba(111,168,255,0.35)', 'rgba(93,227,210,0.6)', 'rgba(93,227,210,0.95)'] }
      },
      series: [{
        type: 'heatmap',
        data: data.map((d) => ({ value: d, label: { color: d[2] >= 3 ? 'rgba(4,7,14,0.9)' : 'rgba(198,216,242,0.62)' } })),
        label: {
          show: true,
          fontSize: 11,
          fontFamily: 'Bahnschrift, sans-serif',
          formatter: (p) => (p.value[2] ? p.value[2] : '')
        },
        itemStyle: { borderColor: 'rgba(6,10,18,0.85)', borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { shadowBlur: 14, shadowColor: 'rgba(93,227,210,0.6)' } }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 会龄 */
  function renderTenure() {
    const c = getChart('chartTenure');
    if (!c) return;
    const labels = ['1 年内', '1-3 年', '3-5 年', '5 年以上'];
    const counts = [0, 0, 0, 0];
    let sum = 0, n = 0;
    filtered.forEach((m) => {
      if (typeof m['会龄月'] !== 'number') return;
      sum += m['会龄月'];
      n++;
      const y = m['会龄月'] / 12;
      if (y < 1) counts[0]++;
      else if (y < 3) counts[1]++;
      else if (y < 5) counts[2]++;
      else counts[3]++;
    });
    if (!n) { c.setOption(EMPTY, true); return; }
    const avg = sum / n / 12;
    $('#tenureHint').textContent = '平均会龄 ' + avg.toFixed(1) + ' 年';

    c.setOption({
      animationDuration: 900,
      grid: { left: 4, right: 14, top: 34, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">入会 ' + p[0].name + '</div><b style="font-size:15px;color:#EEF4FF">' + p[0].value + '</b> 人 · ' + pct(p[0].value, n)
      }),
      xAxis: {
        type: 'category', data: labels,
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: AXIS_LABEL
      },
      yAxis: { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL, minInterval: 1 },
      series: [{
        type: 'bar',
        data: counts,
        barWidth: '42%',
        itemStyle: {
          borderRadius: [5, 5, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#8FE3D6' },
            { offset: 1, color: 'rgba(93,227,210,0.10)' }
          ])
        },
        emphasis: { itemStyle: { color: '#A8F0E4' } },
        label: { show: true, position: 'top', color: INK.t2, fontSize: 10.5, fontFamily: 'Bahnschrift, sans-serif' }
      }],
      graphic: [{
        type: 'text', right: 2, top: 0,
        style: { text: '新人 ' + pct(counts[0], n), fill: '#5DE3D2', font: '11px Bahnschrift, PingFang SC, sans-serif' }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 生日月 */
  function renderBirthday() {
    if (isPublic()) return;
    const c = getChart('chartBirthday');
    if (!c) return;
    const counts = new Array(12).fill(0);
    let n = 0;
    filtered.forEach((m) => {
      if (!m['生日月']) return;
      counts[m['生日月'] - 1]++;
      n++;
    });
    if (!n) { c.setOption(EMPTY, true); return; }
    const cur = new Date().getMonth(); // 0-based

    c.setOption({
      animationDuration: 900,
      grid: { left: 4, right: 10, top: 30, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p[0].name + ' 月</div><b style="font-size:15px;color:#EEF4FF">' + p[0].value + '</b> 人生日'
      }),
      xAxis: {
        type: 'category',
        data: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, { fontSize: 9.5 })
      },
      yAxis: { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL, minInterval: 1 },
      series: [{
        type: 'bar',
        barWidth: '56%',
        data: counts.map((v, i) => ({
          value: v,
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: i === cur
              ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#F6D9A6' }, { offset: 1, color: 'rgba(240,201,135,0.18)' }])
              : new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(127,179,255,0.9)' }, { offset: 1, color: 'rgba(111,168,255,0.08)' }])
          }
        }))
      }],
      graphic: [{
        type: 'text', right: 2, top: 0,
        style: { text: '本月 ' + counts[cur] + ' 人', fill: '#F0C987', font: '11px Bahnschrift, PingFang SC, sans-serif' }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 公益榜 */
  function renderDeeds() {
    const c = getChart('chartDeeds');
    if (!c) return;
    const top = filtered.filter((m) => m['好人好事数'] > 0)
      .sort((a, b) => b['好人好事数'] - a['好人好事数'])
      .slice(0, 6)
      .reverse();
    if (!top.length) { c.setOption(EMPTY, true); return; }

    c.setOption({
      animationDuration: 900,
      grid: { left: 4, right: 40, top: 8, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(240,201,135,0.06)' } },
        formatter: (p) => {
          const m = top.find((x) => x.会员姓名 === p[0].name) || {};
          return '<div style="color:#EEF4FF;font-size:13px;margin-bottom:3px">' + esc(p[0].name) + '</div>' +
            '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + esc(m.单位名称 || '') + '</div>' +
            '<b style="color:#F0C987">' + p[0].value + '</b> 项公益事迹';
        }
      }),
      xAxis: { type: 'value', show: false, max: Math.max.apply(null, top.map((m) => m['好人好事数'])) * 1.2 },
      yAxis: {
        type: 'category',
        data: top.map((m) => m.会员姓名),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, { color: INK.t2, fontSize: 11 })
      },
      series: [{
        type: 'bar',
        barWidth: 9,
        showBackground: true,
        backgroundStyle: { color: 'rgba(255,255,255,0.035)', borderRadius: 5 },
        data: top.map((m) => m['好人好事数']),
        itemStyle: {
          borderRadius: 5,
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: 'rgba(240,201,135,0.25)' },
            { offset: 1, color: '#F0C987' }
          ]),
          shadowBlur: 10,
          shadowColor: 'rgba(240,201,135,0.35)'
        },
        label: { show: true, position: 'right', distance: 6, color: '#F0C987', fontSize: 11, fontFamily: 'Bahnschrift, sans-serif' }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 到龄关注 */
  function renderAgeWarn() {
    const c = getChart('chartAgeWarn');
    if (!c) return;
    const people = filtered.filter((m) => typeof m.年龄 === 'number' && m.年龄 >= 43).sort((a, b) => b.年龄 - a.年龄);
    const ages = people.map((m) => m.年龄);
    const over = people.filter((m) => m.年龄 > 45).length;
    const at45 = people.filter((m) => m.年龄 === 45).length;
    if (state.internal) {
      $('#ageWarnList').innerHTML = people.length ? people.map((m) => {
        const cls = m.年龄 >= 45 ? 'warn' : 'near';
        const tag = m.年龄 > 45 ? '已到龄' : (m.年龄 === 45 ? '今年' : '2 年内');
        return '<div class="cl-row"><div class="cl-main"><div class="cl-name">' + esc(m.会员姓名) + '</div>' +
          '<div class="cl-sub">' + esc(m.区域) + ' · ' + esc(m.职位归类) + '</div></div>' +
          '<span class="cl-val">' + m.年龄 + '</span><span class="cl-tag ' + cls + '">' + tag + '</span></div>';
      }).join('') : '<div class="cl-row">当前筛选下暂无</div>';
    }
    $('#ageWarnHint').textContent = '45 岁以上 ' + over + ' 人';
    $('#ageWarnNote').textContent = '超过 45 岁 ' + over + ' 人 · 今年满 45 岁 ' + at45 + ' 人';
    if (!ages.length) { c.setOption(EMPTY, true); return; }

    const maxAge = Math.max(47, Math.max.apply(null, ages));
    const labels = [];
    const counts = [];
    for (let a2 = 43; a2 <= maxAge; a2++) {
      labels.push(String(a2));
      counts.push(ages.filter((v) => v === a2).length);
    }

    c.setOption({
      animationDuration: 800,
      grid: { left: 2, right: 8, top: 26, bottom: 2, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p[0].name + ' 岁</div><b style="font-size:15px;color:#EEF4FF">' + p[0].value + '</b> 人'
      }),
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, { fontSize: 10, formatter: (v) => v + '岁' })
      },
      yAxis: { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL, minInterval: 1 },
      series: [{
        type: 'bar',
        barWidth: '52%',
        data: labels.map((lb, i) => ({
          value: counts[i],
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: Number(lb) > 45
              ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#F0C987' }, { offset: 1, color: 'rgba(240,201,135,0.12)' }])
              : new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(127,179,255,0.92)' }, { offset: 1, color: 'rgba(111,168,255,0.10)' }])
          }
        })),
        label: { show: true, position: 'top', color: INK.t2, fontSize: 10.5, fontFamily: 'Bahnschrift, sans-serif' }
      }]
    }, true);
  }

  function exportAgeList() {
    const rows = filtered.filter((m) => typeof m.年龄 === 'number' && m.年龄 >= 43).sort((a2, b2) => b2.年龄 - a2.年龄);
    if (!rows.length) { toast('当前筛选下没有 43 岁以上会员'); return; }
    const head = ['序号', '会员姓名', '年龄', '所属区域', '会内职位', '入会日期', '是否超过45岁'];
    const body = rows.map((m) => [m.序号, m.会员姓名, m.年龄, m.区域, m.会内职位, m.申请日期, m.年龄 > 45 ? '是' : '否']);
    const csv = [head].concat(body).map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(blob);
    a2.download = '到龄关注名单_' + new Date().toISOString().slice(0, 10) + '.csv';
    a2.click();
    setTimeout(() => URL.revokeObjectURL(a2.href), 3000);
  }

  /* ------------------------------------------------------------ 会费 */
  function renderFee() {
    if (isPublic()) return;
    const c = getChart('chartFee');
    if (!c) return;
    const valid = filtered.filter((m) => m.会费状态 === '有效').length;
    const expired = filtered.filter((m) => m.会费状态 === '已到期').length;
    const unknown = filtered.length - valid - expired;
    $('#feeHint').textContent = pct(valid, filtered.length) + ' 在有效期';
    $('#feeNote').textContent = '有效 ' + valid + ' · 已到期 ' + expired + ' · 未登记 ' + unknown;

    if (state.internal) {
      const rows = filtered
        .filter((m) => m.会费状态 !== '有效' || (typeof m.会费剩余天 === 'number' && m.会费剩余天 <= 90))
        .sort((a, b) => (a.会费剩余天 == null ? 9999 : a.会费剩余天) - (b.会费剩余天 == null ? 9999 : b.会费剩余天));
      $('#feeList').innerHTML = rows.length ? rows.map((m) => {
        const d = m.会费剩余天;
        const cls = d == null ? 'near' : (d < 0 ? 'warn' : 'near');
        const tag = d == null ? '未登记' : (d < 0 ? '已到期 ' + Math.abs(d) + ' 天' : '剩 ' + d + ' 天');
        return '<div class="cl-row"><div class="cl-main"><div class="cl-name">' + esc(m.会员姓名) + '</div>' +
          '<div class="cl-sub">' + esc(String(m.单位名称 || '').slice(0, 18)) + '</div></div>' +
          '<span class="cl-tag ' + cls + '">' + tag + '</span></div>';
      }).join('') : '<div class="cl-row">当前筛选下全部有效</div>';
    }

    if (!filtered.length) { c.setOption(EMPTY, true); return; }
    c.setOption({
      animationDuration: 800,
      tooltip: Object.assign({}, TT, {
        trigger: 'item',
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p.name + '</div><b style="font-size:15px;color:#EEF4FF">' + p.value + '</b> 人 · ' + p.percent + '%'
      }),
      series: [{
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '50%'],
        padAngle: 3,
        itemStyle: { borderRadius: 5, borderColor: 'rgba(6,10,18,0.9)', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data: [
          { name: '有效', value: valid, itemStyle: { color: '#5DE3D2' } },
          { name: '已到期', value: expired, itemStyle: { color: '#F0C987' } },
          { name: '未登记', value: unknown, itemStyle: { color: '#54657F' } }
        ].filter((d) => d.value > 0)
      }],
      graphic: [
        { type: 'text', left: 'center', top: '43%', style: { text: pct(valid, filtered.length), fill: '#EEF4FF', font: '600 22px Bahnschrift, sans-serif', textAlign: 'center' } },
        { type: 'text', left: 'center', top: '56%', style: { text: '会费有效', fill: '#6B7F9E', font: '10px sans-serif', textAlign: 'center' } }
      ]
    }, true);
  }

  /* ------------------------------------------------------------ 考核 */
  function renderAssess() {
    if (isPublic()) return;
    const c = getChart('chartAssess');
    if (!c) return;
    if (state.assessView === 'activity') { renderActivity(c); return; }
    const vals = filtered.map((m) => m.考核总分).filter((v) => typeof v === 'number');
    if (!vals.length) { c.setOption(EMPTY, true); $('#assessHint').textContent = '—'; return; }
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max.apply(null, vals);
    const min = Math.min.apply(null, vals);
    const bins = ['0 分', '1-20', '21-50', '51-100', '100+'];
    const counts = [0, 0, 0, 0, 0];
    vals.forEach((v) => {
      if (v === 0) counts[0]++;
      else if (v <= 20) counts[1]++;
      else if (v <= 50) counts[2]++;
      else if (v <= 100) counts[3]++;
      else counts[4]++;
    });
    $('#assessHint').textContent = '平均 ' + Math.round(avg) + ' 分';
    $('#assessNote').textContent = '最高 ' + max + ' · 最低 ' + min + ' · 覆盖 ' + vals.length + ' 人';

    if (state.internal) {
      const sorted = filtered.filter((m) => typeof m.考核总分 === 'number').sort((a, b) => b.考核总分 - a.考核总分);
      const top = sorted.slice(0, 5);
      const bottom = sorted.slice(-5).reverse();
      const row = (m, val) => '<div class="cl-row"><div class="cl-main"><div class="cl-name">' + esc(m.会员姓名) + '</div>' +
        '<div class="cl-sub">' + esc(m.职位归类) + ' · ' + esc(m.区域) + '</div></div>' +
        '<span class="cl-val">' + val + '</span></div>';
      $('#assessList').innerHTML =
        '<div class="cl-head">考核前 5</div>' + top.map((m) => row(m, m.考核总分)).join('') +
        '<div class="cl-head">后 5 位（待沟通）</div>' + bottom.map((m) => row(m, m.考核总分)).join('');
    }

    c.setOption({
      animationDuration: 800,
      grid: { left: 4, right: 10, top: 18, bottom: 2, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p[0].name + ' 分</div><b style="font-size:15px;color:#EEF4FF">' + p[0].value + '</b> 人'
      }),
      xAxis: {
        type: 'category', data: bins,
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, { fontSize: 9.5 })
      },
      yAxis: { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL, minInterval: 1 },
      series: [{
        type: 'bar',
        data: counts,
        barWidth: '46%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(167,139,250,0.95)' },
            { offset: 1, color: 'rgba(167,139,250,0.10)' }
          ])
        },
        label: { show: true, position: 'top', color: INK.t2, fontSize: 10.5, fontFamily: 'Bahnschrift, sans-serif' }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 活动参与 */
  function renderActivity(c) {
    const vals = filtered.map((m) => m.活动次数).filter((v) => typeof v === 'number');
    if (!vals.length) { c.setOption(EMPTY, true); $('#assessHint').textContent = '—'; return; }
    const bins = ['0 次', '1 次', '2 次', '3-5 次', '6 次以上'];
    const counts = [0, 0, 0, 0, 0];
    vals.forEach((v) => {
      if (v === 0) counts[0]++;
      else if (v === 1) counts[1]++;
      else if (v === 2) counts[2]++;
      else if (v <= 5) counts[3]++;
      else counts[4]++;
    });
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = sum / vals.length;
    $('#assessHint').textContent = '人均 ' + avg.toFixed(1) + ' 次';
    $('#assessNote').textContent = '参与 ' + vals.filter((v) => v > 0).length + ' 人 · 零参与 ' + counts[0] + ' 人 · 合计 ' + Math.round(sum) + ' 人次';

    if (state.internal) {
      const sorted = filtered.filter((m) => typeof m.活动次数 === 'number').sort((a, b) => b.活动次数 - a.活动次数);
      const row = (m) => '<div class="cl-row"><div class="cl-main"><div class="cl-name">' + esc(m.会员姓名) + '</div>' +
        '<div class="cl-sub">' + esc(m.职位归类) + ' · ' + esc(m.区域) + '</div></div>' +
        '<span class="cl-val">' + Math.round(m.活动次数) + ' 次</span></div>';
      $('#assessList').innerHTML = '<div class="cl-head">参与最多 5 位</div>' + sorted.slice(0, 5).map(row).join('') +
        '<div class="cl-head">未参与（前 5 位）</div>' + sorted.slice(-5).reverse().map(row).join('');
    }

    c.setOption({
      animationDuration: 800,
      grid: { left: 4, right: 10, top: 18, bottom: 2, containLabel: true },
      tooltip: Object.assign({}, TT, {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(111,168,255,0.06)' } },
        formatter: (p) => '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">参加 ' + p[0].name + '</div><b style="font-size:15px;color:#EEF4FF">' + p[0].value + '</b> 人 · ' + pct(p[0].value, vals.length)
      }),
      xAxis: {
        type: 'category', data: bins,
        axisLine: { lineStyle: { color: 'rgba(142,172,222,0.16)' } },
        axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_LABEL, { fontSize: 9.5 })
      },
      yAxis: { type: 'value', splitLine: SPLIT, axisLabel: AXIS_LABEL, minInterval: 1 },
      series: [{
        type: 'bar',
        data: counts,
        barWidth: '46%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(93,227,210,0.95)' },
            { offset: 1, color: 'rgba(93,227,210,0.10)' }
          ])
        },
        label: { show: true, position: 'top', color: INK.t2, fontSize: 10.5, fontFamily: 'Bahnschrift, sans-serif' }
      }]
    }, true);
  }

  /* ------------------------------------------------------------ 企业画像 */
  function renderCorp() {
    const tagCount = {};
    filtered.forEach((m) => (m.企业标签 || []).forEach((k) => { tagCount[k] = (tagCount[k] || 0) + 1; }));
    const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);
    const tagged = filtered.filter((m) => (m.企业标签 || []).length).length;

    $('#corpTags').innerHTML = tags.length
      ? tags.map((k) => '<button type="button" class="corp-tag" data-tag="' + esc(k) + '">' + esc(k) + ' <b>' + tagCount[k] + '</b></button>').join('')
      : '<span class="corp-tag">暂无企业标签</span>';
    $$('#corpTags .corp-tag[data-tag]').forEach((el) => {
      el.onclick = () => openTagDrawer(el.dataset.tag);
    });

    if (isPublic()) { $('#corpStats').innerHTML = ''; $('#corpHint').textContent = tagged + ' 家有标签'; return; }

    const staff = filtered.map((m) => m.员工数).filter((v) => typeof v === 'number' && v > 0).sort((a, b) => a - b);
    const capital = filtered.map((m) => m.注册资金).filter((v) => typeof v === 'number' && v > 0).sort((a, b) => a - b);
    const tax = filtered.map((m) => m.纳税额).filter((v) => typeof v === 'number' && v > 0);
    const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
    const fmtW = (v) => (v >= 10000 ? (v / 10000).toFixed(1) + ' 亿' : Math.round(v).toLocaleString('zh-CN') + ' 万');

    $('#corpHint').textContent = tagged + ' 家有标签';
    $('#corpStats').innerHTML = [
      ['平均员工数', staff.length ? Math.round(staff.reduce((a, b) => a + b, 0) / staff.length) : 0, '人', staff.length],
      ['注册资金中位数', fmtW(median(capital)), '', capital.length],
      ['最近一年纳税合计', fmtW(tax.reduce((a, b) => a + b, 0)), '', tax.length]
    ].map((row) =>
      '<div class="corp-stat"><span>' + row[0] + '</span><span><b>' + row[1] + '</b>' + (row[2] ? ' <em>' + row[2] + '</em>' : '') + ' <em>样本 ' + row[3] + '</em></span></div>'
    ).join('');
  }

  /* ------------------------------------------------------------ 地图 */  /* ------------------------------------------------------------ 地图 */
  function positionSeries(members, cityOnly) {
    const pts = members.filter((m) => typeof m.lng === 'number' && typeof m.lat === 'number' && (!cityOnly || m.城市 === '沈阳'));
    if (state.hiddenPos.size) return pts.filter((m) => !state.hiddenPos.has(m.职位归类));
    return pts;
  }

  const MAP_SCALE = ["#0A1526", "#102444", "#173A66", "#1F5688", "#2C82A2"];

  function mixColor(a, b, f) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * f);
    const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * f);
    const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * f);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }

  function scaleColor(v, max) {
    if (!v) return MAP_SCALE[0];
    const t = Math.min(1, Math.log1p(v) / Math.log1p(Math.max(2, max)));
    const pos = t * (MAP_SCALE.length - 1);
    const i = Math.min(MAP_SCALE.length - 2, Math.floor(pos));
    return mixColor(MAP_SCALE[i], MAP_SCALE[i + 1], pos - i);
  }

  function shortName(n) {
    return String(n).replace(/区$|县$|市$/, "");
  }

  function positionSeries(members, cityOnly) {
    let pts = members.filter((m) => typeof m.lng === "number" && typeof m.lat === "number" && (!cityOnly || m.城市 === "沈阳"));
    if (state.hiddenPos.size) pts = pts.filter((m) => !state.hiddenPos.has(m.职位归类));
    return pts;
  }

  function mapOption(mapName, counts, max, zoom, cityOnly) {
    const names = new Map(counts);
    const labelOffset = { '和平区': [-22, 12], '沈河区': [10, -10], '大东区': [20, 6], '皇姑区': [-6, -12] };
    const regions = Array.from(names.entries()).map(([name, v]) => ({
      name: name,
      itemStyle: { areaColor: scaleColor(v, max) },
      label: labelOffset[name] ? { offset: labelOffset[name] } : undefined
    }));

    const pts = positionSeries(filtered, cityOnly);
    const leaders = pts.filter((m) => m.职位归类 === "会长" || m.职位归类 === "副会长");
    const rankEl = document.querySelector('.rank');
    const rankW = rankEl && rankEl.offsetParent !== null ? rankEl.offsetWidth + 12 : 0;

    return {
      backgroundColor: "transparent",
      tooltip: Object.assign({}, TT, {
        trigger: "item",
        formatter: (p) => {
          if (p.seriesType === "map") {
            return '<div style="color:#8FA6C8;font-size:11px;margin-bottom:4px">' + p.name + '</div>' +
              '<b style="font-size:15px;color:#EEF4FF">' + (p.value || 0) + '</b> 家会员企业';
          }
          const d = p.data.meta || {};
          return '<div style="color:#EEF4FF;font-size:13px;margin-bottom:3px">' + esc(d.会员姓名) + "</div>" +
            '<div style="color:#8FA6C8;font-size:11px">' + esc(d.单位名称) + "</div>" +
            '<div style="color:#6B7F9E;font-size:11px;margin-top:3px">' + esc(d.职位归类) + " · " + esc(d.区域) + "</div>";
        }
      }),
      geo: {
        map: mapName,
        roam: true,
        zoom: zoom,
        center: undefined,
        right: rankW,
        top: "0%",
        bottom: "0%",
        scaleLimit: { min: 0.8, max: 6 },
        label: {
          show: true,
          color: "rgba(208,224,248,0.8)",
          fontSize: 8.5,
          textShadowColor: "rgba(2,6,12,0.95)",
          textShadowBlur: 4,
          formatter: (p) => shortName(p.name)
        },
        itemStyle: {
          areaColor: "#0B1728",
          borderColor: "rgba(111,168,255,0.32)",
          borderWidth: 0.9,
          shadowColor: "rgba(62,120,220,0.40)",
          shadowBlur: 22,
          shadowOffsetY: 6
        },
        emphasis: {
          label: { show: true, color: "#FFFFFF", fontSize: 10 },
          itemStyle: { areaColor: "rgba(38,76,130,0.95)" }
        },
        select: { disabled: true },
        regions: regions
      },
      series: [
        {
          type: "map",
          map: mapName,
          geoIndex: 0,
          data: Array.from(names.entries()).map((e) => ({ name: e[0], value: e[1] })),
          label: { show: false },
          itemStyle: { areaColor: "transparent" },
          emphasis: { itemStyle: { areaColor: "transparent" } }
        },
        {
          type: "scatter",
          coordinateSystem: "geo",
          data: pts.map((m) => ({
            value: [m.lng, m.lat],
            meta: m,
            itemStyle: { color: POS_COLOR[m.职位归类] || "#8FA6C8", opacity: 0.8 }
          })),
          symbolSize: (val, params) => ({ "会长": 10, "副会长": 7, "理事": 5.5, "会员": 4, "其他": 3.5 }[params.data.meta.职位归类] || 4),
          itemStyle: { shadowBlur: 8, shadowColor: "rgba(111,168,255,0.55)" },
          z: 3
        },
        {
          type: "effectScatter",
          coordinateSystem: "geo",
          data: leaders.map((m) => ({ value: [m.lng, m.lat], meta: m, itemStyle: { color: POS_COLOR[m.职位归类] } })),
          symbolSize: 8,
          rippleEffect: { brushType: "stroke", scale: 2.6, period: 4 },
          z: 4
        }
      ]
    };
  }

  function renderMapCity() {
    const c = getChart("chartMapCity");
    if (!c) return;
    const counts = countBy(filtered.filter((m) => m.区域 !== "其他"), "区域");
    const max = Math.max(1, ...Array.from(counts.values()));
    c.setOption(mapOption("shenyang", counts, max, 1.02, true), true);
  }

  function renderMapProvince() {
    const c = getChart("chartMapProvince");
    if (!c) return;
    const counts = new Map();
    countBy(filtered.filter((m) => m.省内), "城市").forEach((v, k) => counts.set(k + "市", v));
    const max = Math.max(1, ...Array.from(counts.values()));
    c.setOption(mapOption("liaoning", counts, max, 1.02, false), true);
  }

  const CORE_DISTRICTS = ['和平区', '沈河区', '大东区', '皇姑区', '铁西区', '于洪区', '浑南区', '沈北新区', '苏家屯区'];

  function renderMapStats() {
    const el = $('#mapStats');
    if (!el) return;
    if (state.view !== 'city') { el.style.display = 'none'; return; }
    el.style.display = '';
    const core = filtered.filter((m) => CORE_DISTRICTS.indexOf(m.区域) >= 0).length;
    const rural = filtered.filter((m) => m.区域 !== '其他' && CORE_DISTRICTS.indexOf(m.区域) < 0).length;
    el.innerHTML = '<div class="row"><b>' + core + '</b><span>中心城区会员</span></div>' +
      '<div class="row"><b>' + rural + '</b><span>县域会员</span></div>';
  }

  function renderMapHud() {
    const el = $('#mapHud');
    if (!el) return;
    if (state.view === 'city') {
      const n = filtered.filter((m) => m.城市 === '沈阳').length;
      el.innerHTML = '<span class="k">沈阳市</span><b>' + n + '</b><em>家 · ' + pct(n, filtered.length) + '</em>';
    } else {
      const n = filtered.filter((m) => m.省内).length;
      el.innerHTML = '<span class="k">辽宁省</span><b>' + n + '</b><em>家 · ' + pct(n, filtered.length) + '</em>';
    }
  }

  function renderMapLegend() {
    const el = $('#mapLegend');
    const counts = countBy(filtered, '职位归类');
    el.innerHTML = POS.map((p) =>
      '<div class="li' + (state.hiddenPos.has(p.key) ? ' off' : '') + '" data-pos="' + p.key + '">' +
      '<span class="dot" style="background:' + p.color + ';color:' + p.color + '"></span>' +
      '<span>' + p.key + '</span><span class="n">' + (counts.get(p.key) || 0) + '</span></div>'
    ).join('');

    $$('.li', el).forEach((li) => {
      li.onclick = () => {
        const k = li.dataset.pos;
        if (state.hiddenPos.has(k)) state.hiddenPos.delete(k);
        else state.hiddenPos.add(k);
        renderMapLegend();
        renderMapCity();
        renderMapProvince();
      };
    });
  }

  function renderRank() {
    const el = $('#rankList');
    const isCity = state.view === 'city';
    const key = isCity ? '区域' : '城市';
    const LIAONING = ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'];
    let entries = sortedEntries(countBy(filtered, key)).filter((e) => e[0] !== '其他' && e[0] !== '未知');
    if (!isCity) entries = entries.filter((e) => LIAONING.indexOf(e[0]) >= 0);
    const allCount = new Set(filtered.map((m) => m[key]).filter((v) => v && v !== '其他' && v !== '未知' && (isCity || LIAONING.indexOf(v) >= 0))).size;
    entries = entries.slice(0, 7);
    const max = entries.length ? entries[0][1] : 1;
    el.innerHTML = '<h4>' + (isCity ? '区县分布' : '城市分布') + '</h4>' + entries.map((e, i) =>
      '<div class="rank-row" data-v="' + esc(e[0]) + '">' +
      '<span class="rank-i">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<div class="rank-main"><div class="rank-name">' + esc(e[0]) + '</div><div class="rank-bar"><i style="width:' + (e[1] / max) * 100 + '%"></i></div></div>' +
      '<span class="rank-n">' + e[1] + '</span></div>'
    ).join('') + '<div class="rank-foot">共 ' + allCount + ' 个' + (isCity ? '区县' : '城市') + ' · 显示前 ' + entries.length + '</div>';

    $$('.rank-row', el).forEach((row) => {
      row.onclick = () => {
        const v = row.dataset.v;
        if (isCity) state.filters.district = v;
        else if (v === '沈阳') { switchView('city'); return; }
        state.page = 1;
        syncFilterUI();
        render();
      };
    });
  }

  function syncFilterUI() {
    $$('.dd').forEach((dd) => {
      const key = dd.dataset.key;
      $('.dd-btn .v', dd).textContent = state.filters[key];
      dd.classList.toggle('on', state.filters[key] !== '全部');
      $$('.dd-item', dd).forEach((it) => it.classList.toggle('sel', it.dataset.v === state.filters[key]));
    });
    $$('#segGender button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.filters.gender));
  }

  function switchView(v) {
    state.view = v;
    $$('#mapTabs button').forEach((b) => b.classList.toggle('on', b.dataset.map === v));
    $('#chartMapCity').classList.toggle('hidden', v !== 'city');
    $('#chartMapProvince').classList.toggle('hidden', v !== 'province');
    if (v === 'city') renderMapCity();
    else renderMapProvince();
    renderMapHud();
    renderMapStats();
    setTimeout(() => { if (charts.chartMapCity) charts.chartMapCity.resize(); if (charts.chartMapProvince) charts.chartMapProvince.resize(); }, 30);
    renderRank();
  }

  /* ------------------------------------------------------------ 表格 */
  function sortedRows() {
    const key = state.sort.key;
    const dir = state.sort.dir;
    return filtered.slice().sort((a, b) => {
      let x = a[key];
      let y = b[key];
      if (key === '申请年份') { x = x || 0; y = y || 0; }
      if (key === '好人好事数') { x = x || 0; y = y || 0; }
      if (typeof x === 'string') return x.localeCompare(y, 'zh-CN') * dir;
      return ((x || 0) - (y || 0)) * dir;
    });
  }

  function posBadge(m) {
    const p = typeof m === 'string' ? m : m.职位归类;
    const label = p === '其他' && m && m.会内职位 ? m.会内职位 : p;
    const cls = { '会长': 'gold', '副会长': 'blue', '理事': 'teal', '会员': 'slate', '其他': 'violet' }[p] || 'slate';
    return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
  }

  function renderTable() {
    const rows = sortedRows();
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const slice = rows.slice(start, start + state.pageSize);

    $('#tblCount').textContent = fmt(total);
    $('#tblBody').innerHTML = slice.length ? slice.map((m) => {
      const deed = m.好人好事
        ? '<span class="deed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z"/></svg>' + m.好人好事数 + '</span>'
        : '<span style="color:#3A4B63">—</span>';
      return '<tr data-i="' + m.序号 + '">' +
        '<td><div class="person"><span class="avatar" style="background:' + hexA(POS_COLOR[m.职位归类] || '#8FA6C8', 0.14) + ';border-color:' + hexA(POS_COLOR[m.职位归类] || '#8FA6C8', 0.32) + ';color:' + (POS_COLOR[m.职位归类] || '#8FA6C8') + '">' + esc(m.会员姓名.slice(0, 1)) + '</span><span class="nm">' + esc(m.会员姓名) + '</span></div></td>' +
        '<td>' + posBadge(m) + '</td>' +
        '<td title="' + esc(m.单位名称) + '">' + esc(m.单位名称) + '</td>' +
        '<td>' + esc(m.所属行业) + '</td>' +
        '<td>' + esc(m.区域) + '</td>' +
        '<td>' + esc(m.政治面貌) + '</td>' +
        '<td style="font-family:Bahnschrift,sans-serif">' + (m.申请年份 || '—') + '</td>' +
        '<td>' + deed + '</td></tr>';
    }).join('') : '<tr><td colspan="8" style="text-align:center;padding:38px 0;color:#475A76">没有符合条件的会员</td></tr>';

    $$('#tblBody tr').forEach((tr) => {
      tr.onclick = () => openDrawer(tr.dataset.i);
    });

    $('#pagerInfo').textContent = total ? '第 ' + (start + 1) + '–' + Math.min(start + state.pageSize, total) + ' 条 / 共 ' + fmt(total) + ' 条' : '无匹配记录';

    const btns = [];
    btns.push('<button class="pg" data-p="prev"' + (state.page === 1 ? ' disabled' : '') + '>‹</button>');
    const windowSize = 5;
    let from = Math.max(1, state.page - 2);
    let to = Math.min(pages, from + windowSize - 1);
    from = Math.max(1, to - windowSize + 1);
    for (let p = from; p <= to; p++) btns.push('<button class="pg' + (p === state.page ? ' on' : '') + '" data-p="' + p + '">' + p + '</button>');
    btns.push('<button class="pg" data-p="next"' + (state.page === pages ? ' disabled' : '') + '>›</button>');
    $('#pagerBtns').innerHTML = btns.join('');

    $$('#pagerBtns .pg').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.p;
        if (v === 'prev') state.page = Math.max(1, state.page - 1);
        else if (v === 'next') state.page = Math.min(pages, state.page + 1);
        else state.page = Number(v);
        renderTable();
      };
    });
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ------------------------------------------------------------ 抽屉 */
  function openTagDrawer(tag) {
    const list = filtered.filter((m) => (m.企业标签 || []).indexOf(tag) >= 0);
    $('#drawerBody').innerHTML =
      '<div class="drawer-hero"><div><div class="drawer-name">' + esc(tag) + '</div>' +
      '<div class="drawer-org">共 ' + list.length + ' 家会员企业 · 点击查看会员详情</div></div></div>' +
      (list.length
        ? '<div class="tag-list">' + list.map((m) =>
          '<button type="button" class="tag-row" data-i="' + m.序号 + '">' +
          '<span class="tag-row-name">' + esc(m.会员姓名) + '</span>' +
          '<span class="tag-row-org">' + esc(m.单位名称) + '</span>' +
          '<span class="tag-row-region">' + esc(m.区域) + '</span></button>').join('') + '</div>'
        : '<p style="color:#6B7F9E;font-size:12px">当前筛选下暂无</p>');
    $$('#drawerBody .tag-row').forEach((b) => {
      b.onclick = () => openDrawer(b.dataset.i);
    });
    $('#drawer').classList.add('on');
    $('#drawerMask').classList.add('on');
  }

  function openDrawer(id) {
    const key = Number(id);
    const m = filtered.find((x) => x.序号 === key) || state.all.find((x) => x.序号 === key);
    if (!m) return;
    const rows = [
      ['会内职位', m.会内职位],
      ['所属行业', m.所属行业],
      ['政治面貌', m.政治面貌 + (m.政治面貌归类 && m.政治面貌归类 !== m.政治面貌 ? ' · ' + m.政治面貌归类 : '')],
      ['所属区域', m.区域 + (m.城市 && m.城市 !== '未知' ? ' · ' + m.城市 : '')],
      ['入会时间', (m.申请日期 || '—') + (m.会龄月 ? '（会龄 ' + Math.floor(m.会龄月 / 12) + ' 年 ' + (m.会龄月 % 12) + ' 个月）' : '')],
      ['注册地址', m.注册地址 || '—'],
      ['经营范围', m.经营范围 || '—']
    ];

    $('#drawerBody').innerHTML =
      '<div class="drawer-hero">' +
      '<div class="drawer-avatar">' + esc(m.会员姓名.slice(0, 1)) + '</div>' +
      '<div><div class="drawer-name">' + esc(m.会员姓名) + ' ' + posBadge(m) + '</div><div class="drawer-org">' + esc(m.单位名称) + '</div></div>' +
      '</div>' +
      '<dl class="dl">' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' +
      (m.好人好事
        ? '<div class="deed-box"><h5>好人好事 · ' + m.好人好事数 + ' 项</h5>' + deedListHtml(m) + '</div>'
        : '');

    $('#drawer').classList.add('on');
    $('#drawerMask').classList.add('on');
  }

  function closeDrawer() {
    $('#drawer').classList.remove('on');
    $('#drawerMask').classList.remove('on');
  }

  function deedListHtml(m) {
    const raw = String(m['好人好事全文'] || m['好人好事摘要'] || '').replace(/\r/g, '');
    const items = raw.split(/[；;\n]+/).map((s) => s.trim().replace(/[。；;，,]+$/, '')).filter(Boolean);
    const sum = estimateAmount(raw);
    const body = items.length > 1
      ? '<ol class="deed-list">' + items.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>'
      : '<p>' + esc(items[0] || '—') + '</p>';
    return body + (sum ? '<div class="deed-sum"><span>文内提及金额合计（估算）</span><b>' + sum + '</b></div>' : '');
  }

  function estimateAmount(text) {
    let total = 0;
    const re = /(\d+(?:\.\d+)?)\s*(万元|万|元)/g;
    let mt;
    while ((mt = re.exec(text))) {
      const v = parseFloat(mt[1]);
      if (!isFinite(v)) continue;
      total += mt[2].charAt(0) === '万' ? v * 10000 : v;
    }
    if (!total) return '';
    return total >= 10000
      ? (total / 10000).toFixed(1).replace(/\.0$/, '') + ' 万元'
      : total.toLocaleString('zh-CN') + ' 元';
  }

  /* ------------------------------------------------------------ 导出 */
  function exportCSV() {
    const rows = sortedRows();
    const head = ['序号', '会员姓名', '会内职位', '职位归类', '单位名称', '性别', '年龄', '政治面貌', '所属行业', '区域', '城市', '申请日期', '好人好事'];
    const body = rows.map((m) => [m.序号, m.会员姓名, m.会内职位, m.职位归类, m.单位名称, m.性别, m.年龄 || '', m.政治面貌, m.所属行业, m.区域, m.城市, m.申请日期, m.好人好事 ? '是' : '否']);
    const csv = [head].concat(body).map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '商会会员明细_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* ------------------------------------------------------------ 自定义指标 */
  function loadCustom() {
    try {
      state.custom = JSON.parse(localStorage.getItem('shjc.customKpi') || '[]');
    } catch (e) { state.custom = []; }
  }

  function saveCustom() {
    try { localStorage.setItem('shjc.customKpi', JSON.stringify(state.custom)); } catch (e) { /* ignore */ }
  }

  function renderCustomCards() {
    $$('.kpi.custom-card').forEach((el) => el.remove());
    const row = $('#kpiRow');
    const addBtn = $('#addKpiBtn');
    state.custom.forEach((c, idx) => {
      const el = document.createElement('article');
      el.className = 'card kpi custom-card';
      el.dataset.field = c.field;
      el.dataset.value = c.value;
      el.style.setProperty('--c1', '#9fe8ff');
      el.style.setProperty('--c2', '#a78bfa');
      el.innerHTML = '<div class="kpi-top"><span class="kpi-label">' + esc(c.title) + '</span>' +
        '<span class="kpi-del" data-idx="' + idx + '" title="删除">×</span></div>' +
        '<div class="kpi-val"><span class="kpi-num" data-count>0</span><span class="kpi-unit">人</span></div>' +
        '<div class="kpi-foot"><span class="kpi-note">—</span></div>';
      row.insertBefore(el, addBtn);
      $('.kpi-del', el).onclick = (e) => {
        e.stopPropagation();
        state.custom.splice(idx, 1);
        saveCustom();
        renderCustomCards();
        renderKPI();
      };
    });
  }

  function openKpiModal() {
    const fieldSel = $('#kpiField');
    const valSel = $('#kpiValue');
    const fill = () => {
      const field = fieldSel.value;
      const values = Array.from(new Set(state.all.map((m) => m[field]).filter((v) => v != null && v !== ''))).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
      valSel.innerHTML = values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    };
    fill();
    fieldSel.onchange = fill;
    $('#kpiTitle').value = '';
    $('#kpiModal').classList.add('on');
  }

  /* ------------------------------------------------------------ 主渲染 */
  function render() {
    computeFiltered();
    renderKPI();
    renderIndustry();
    renderAge();
    renderPolitical();
    renderPosition();
    renderGender();
    renderTrend();
    renderHeat();
    renderTenure();
    renderBirthday();
    renderDeeds();
    renderAgeWarn();
    renderFee();
    renderAssess();
    renderCorp();
    if (state.view === 'city') renderMapCity(); else renderMapProvince();
    renderMapLegend();
    renderMapHud();
    renderMapStats();
    renderRank();
    renderTable();
  }

  /* ------------------------------------------------------------ 初始化 */
  function boot() {
    const qs = new URLSearchParams(location.search);
    if (qs.get('view') === 'province') state.view = 'province';
    const meta = state.meta || {};
    $('#updatedAt').textContent = (meta['生成时间'] || '—').replace(/-/g, '.');
    if (meta['版本'] === 'public') document.body.classList.add('public');
    const cutoff = meta['统计截止'] || '';
    $('#heroDate').textContent = cutoff ? cutoff.replace(/-/g, '.') : '—';

    const districts = new Set(state.all.map((m) => m.区域).filter((d) => d && d !== '其他')).size;
    const industries = new Set(state.all.map((m) => m.所属行业).filter((d) => d && d !== '未登记')).size;
    $('#heroDistricts').textContent = districts;
    $('#heroIndustries').textContent = industries;
    $('#ftSource').textContent = meta['数据源'] || '商会BI数据.xlsx';
    $('#ftYear').textContent = new Date().getFullYear();

    buildDropdowns();
    try {
      if (sessionStorage.getItem('shjc.internal') === '1') {
        state.internal = true;
        document.body.classList.add('internal');
        $('#internalBtn').classList.add('on');
      }
    } catch (e) { /* ignore */ }
    loadCustom();
    renderCustomCards();

    if (typeof echarts !== 'undefined') {
      echarts.registerMap('shenyang', window.SHENYANG_GEO);
      echarts.registerMap('liaoning', window.LIAONING_GEO);
      render();
    } else {
      toast('图表库加载失败，请检查 assets/vendor/echarts.min.js');
      render();
    }
    if (state.view === 'province') switchView('province');
    const mid = qs.get('member');
    if (mid) setTimeout(() => openDrawer(mid), 400);

    $('#industryTabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('on')) return;
      $$('#industryTabs button').forEach((x) => x.classList.toggle('on', x === b));
      state.industryView = b.dataset.view;
      renderIndustry();
    };
    $('#assessTabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('on')) return;
      $$('#assessTabs button').forEach((x) => x.classList.toggle('on', x === b));
      state.assessView = b.dataset.view;
      renderAssess();
    };
    $('#trendTabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('on')) return;
      $$('#trendTabs button').forEach((x) => x.classList.toggle('on', x === b));
      state.trendView = b.dataset.view;
      renderTrend();
    };

    $('#mapTabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (b && b.dataset.map !== state.view) switchView(b.dataset.map);
    };

    if (STATIC_MODE) $$('.reveal').forEach((el) => el.classList.add('in'));
    else requestAnimationFrame(() => {
      $$('.reveal').forEach((el, i) => setTimeout(() => el.classList.add('in'), 60 + i * 70));
    });
  }

  function setInternal(on) {
    if (isPublic()) return;
    state.internal = !!on;
    document.body.classList.toggle('internal', state.internal);
    $('#internalBtn').classList.toggle('on', state.internal);
    try { sessionStorage.setItem('shjc.internal', state.internal ? '1' : '0'); } catch (e) { /* ignore */ }
    renderAgeWarn();
    renderFee();
    renderAssess();
    if (!state.internal) {
      setTimeout(() => ['chartAgeWarn', 'chartFee', 'chartAssess'].forEach((id) => {
        if (charts[id]) charts[id].resize();
      }), 60);
    }
  }

  /* ------------------------------------------------------------ 交互绑定 */
  function bindStatic() {
    $('#refreshBtn').onclick = () => loadData(true);
    $('#internalBtn').onclick = () => setInternal(!state.internal);
    $('#exportBtn').onclick = exportCSV;
    $('#ageWarnExport').onclick = exportAgeList;
    $('#drawerClose').onclick = closeDrawer;
    $('#drawerMask').onclick = closeDrawer;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDrawer(); $('#kpiModal').classList.remove('on'); }
    });

    $('#fsBtn').onclick = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    };

    $('#addKpiBtn').onclick = openKpiModal;
    $('#kpiCancel').onclick = () => $('#kpiModal').classList.remove('on');
    $('#kpiConfirm').onclick = () => {
      const field = $('#kpiField').value;
      const value = $('#kpiValue').value;
      const title = ($('#kpiTitle').value || '').trim() || value;
      if (!value) return;
      state.custom.push({ field, value, title });
      saveCustom();
      renderCustomCards();
      renderKPI();
      $('#kpiModal').classList.remove('on');
    };
    $('#kpiModal').onclick = (e) => { if (e.target.id === 'kpiModal') $('#kpiModal').classList.remove('on'); };

    // 排序
    $$('.tbl thead th').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) state.sort.dir *= -1;
        else { state.sort.key = key; state.sort.dir = 1; }
        $$('.tbl thead th').forEach((x) => { x.classList.remove('sorted'); $('.ar', x)?.remove(); });
        th.classList.add('sorted');
        const ar = document.createElement('span');
        ar.className = 'ar';
        ar.textContent = state.sort.dir > 0 ? '▲' : '▼';
        th.appendChild(ar);
        renderTable();
      };
    });

    // 卡片光标高光
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest ? e.target.closest('.card') : null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
    }, { passive: true });

    // 自适应
    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => Object.values(charts).forEach((c) => c && c.resize()), 160);
    });
  }

  window.addEventListener('error', (e) => {
    console.error(e.error || e.message);
    if (e.message) toast('脚本异常：' + e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && e.reason.message) toast('数据处理异常：' + e.reason.message);
  });

  bindStatic();
  loadData(false);
})();
