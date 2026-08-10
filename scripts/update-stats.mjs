// vcroute.com 주간 수치 크롤러
//  필수(통계밴드):
//   - 홈(/)                 : 등록펀드(funds), 투자자(investors)
//   - /funds/categories     : 2026 신생펀드 수(newFunds2026), 결성금액 조원(newFunds2026Amount)
//  선택(서비스 본문, 있으면 갱신): 활성펀드(activeFunds), 모태펀드(motherFunds)
//  → index.html 수치 교체 + data/stats.json 갱신
//  실행: node scripts/update-stats.mjs [--dry]

import fs from 'fs';

const DRY = process.argv.includes('--dry');
const HOME = 'https://vcroute.com/';
const CATS = 'https://vcroute.com/funds/categories';
const STATS_PATH = 'data/stats.json';
const HTML_PATH = 'index.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const fmt = (n) => n.toLocaleString('en-US');

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fetch 실패 ${url}: HTTP ${res.status}`);
  const html = await res.text();
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

async function main() {
  const home = await getText(HOME);
  const cats = await getText(CATS);
  const pI = (t, re) => { const m = t.match(re); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
  const pF = (t, re) => { const m = t.match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };

  // 필수 4개
  const live = {
    funds:              pI(home, /([\d,]+)\s*개\s*펀드/),
    investors:          pI(home, /([\d,]+)\s*개\s*투자자/),
    newFunds2026:       pI(cats, /최근\(2026\)\s*통계\s*총\s*펀드\s*([\d,]+)\s*개/),
    newFunds2026Amount: pF(cats, /총\s*결성금액\s*([\d.,]+)\s*조원/),
  };
  const req = { funds: [1, 1e6], investors: [1, 1e6], newFunds2026: [1, 1e5], newFunds2026Amount: [0.1, 1e4] };
  for (const [k, [lo, hi]] of Object.entries(req)) {
    const v = live[k];
    if (v == null || Number.isNaN(v) || v < lo || v > hi) {
      throw new Error(`필수 수치 추출 실패/비정상: ${k}=${v} (vcroute 구조 변경 또는 서버 문제 가능)`);
    }
  }

  // 선택 2개 (추출되면 반영)
  const opt = {
    activeFunds: pI(home, /활성\s*펀드\s*([\d,]+)/),
    motherFunds: pI(home, /모태자펀드\s*([\d,]+)/),
  };
  for (const [k, v] of Object.entries(opt)) {
    if (Number.isInteger(v) && v > 0 && v < 1e6) live[k] = v;
  }
  console.log('크롤 결과:', live);

  const cur = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  const next = { ...cur, ...live, updated: new Date().toISOString().slice(0, 10) };

  // index.html 콤마표기 수치 교체
  let idx = fs.readFileSync(HTML_PATH, 'utf-8');
  for (const k of ['funds', 'investors', 'activeFunds', 'motherFunds']) {
    if (live[k] != null && cur[k] && cur[k] !== live[k]) idx = idx.split(fmt(cur[k])).join(fmt(live[k]));
  }
  // 통계밴드 countUp: s1 등록펀드 · s2 투자자 · s3 신생펀드(개) · s4 결성금액(조원,소수1)
  idx = idx.replace(
    /countUp\('s1',[\d.]+\);\s*countUp\('s2',[\d.]+\);\s*countUp\('s3',[\d.]+\);\s*countUp\('s4',[\d.]+(?:,\d+)?\);/,
    `countUp('s1',${live.funds}); countUp('s2',${live.investors}); countUp('s3',${live.newFunds2026}); countUp('s4',${live.newFunds2026Amount},1);`
  );

  if (DRY) { console.log('[DRY] 갱신될 stats.json:', next); return; }
  fs.writeFileSync(HTML_PATH, idx);
  fs.writeFileSync(STATS_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log('갱신 완료:', next);
}

main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
