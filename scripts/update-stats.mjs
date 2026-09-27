// vcroute.com API 기반 홈 통계밴드 자동 갱신 (2026-09 피봇 반영)
//
// 홈 통계밴드 5개 지표 → 소스:
//   s1 벤처펀드       : GET /api/v3/fund-analysis  → totals.count
//   s2 투자자         : GET /api/investors         → pagination.universeTotal
//   s3 등록 기업      : GET /about (HTML)           → '스타트업·벤처기업' 앞 숫자
//   s4 2026 신규 펀드  : GET /api/v3/fund-analysis  → tiers[key=NEW].count
//   s5 2026 예정 펀드  : GET /api/v3/fund-analysis  → tiers[key=PLANNED].count
//
// → index.html 의 countUp('s1'…'s5') 타깃 + 콤마표기 수치 교체, data/stats.json 갱신
// 실행: node scripts/update-stats.mjs [--dry]

import fs from 'fs';

const DRY = process.argv.includes('--dry');
const BASE = 'https://www.vcroute.com';
const STATS_PATH = 'data/stats.json';
const HTML_PATH = 'index.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const fmt = (n) => n.toLocaleString('en-US');

async function getJSON(path) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`fetch 실패 ${path}: HTTP ${res.status}`);
  return res.json();
}
async function getText(path) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fetch 실패 ${path}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  // 1) 펀드 지표 (한 번의 호출로 총계 + 신규(NEW) + 예정(PLANNED))
  const fa = await getJSON('/api/v3/fund-analysis');
  const tierCount = (key) => {
    const t = (fa.tiers || []).find((x) => x.key === key);
    return t ? t.count : null;
  };
  // 2) 투자자 유니버스 총계
  const inv = await getJSON('/api/investors');
  // 3) 등록 기업 (JSON API 없음 → /about 서버렌더에서 추출)
  const aboutHtml = await getText('/about');
  const aboutText = aboutHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const compM = aboutText.match(/([\d,]+)\s*스타트업[^\d]{0,6}벤처기업/);

  const live = {
    funds:         fa?.totals?.count ?? null,
    investors:     inv?.pagination?.universeTotal ?? null,
    companies:     compM ? parseInt(compM[1].replace(/,/g, ''), 10) : null,
    newFunds:      tierCount('NEW'),
    plannedFunds:  tierCount('PLANNED'),
  };

  // 유효성 검사 (구조 변경/서버 이상 시 커밋 방지)
  const range = {
    funds: [1000, 5e5], investors: [500, 5e5], companies: [1000, 5e6],
    newFunds: [0, 1e4], plannedFunds: [0, 1e4],
  };
  for (const [k, [lo, hi]] of Object.entries(range)) {
    const v = live[k];
    if (v == null || Number.isNaN(v) || v < lo || v > hi) {
      throw new Error(`수치 추출 실패/비정상: ${k}=${v} (vcroute 구조 변경 또는 서버 문제 가능)`);
    }
  }
  console.log('API 수집 결과:', live);

  const cur = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  const next = { ...cur, ...live, updated: new Date().toISOString().slice(0, 10) };

  let idx = fs.readFileSync(HTML_PATH, 'utf-8');

  // (a) 콤마표기 수치 교체 — 대형 지표만 (소형 신규/예정은 오검출 위험으로 제외)
  for (const k of ['funds', 'investors', 'companies']) {
    if (live[k] != null && cur[k] && cur[k] !== live[k]) {
      idx = idx.split(fmt(cur[k])).join(fmt(live[k]));
    }
  }
  // (b) 통계밴드 countUp 타깃 교체 (s1~s5)
  const countLine = `countUp('s1',${live.funds}); countUp('s2',${live.investors}); countUp('s3',${live.companies}); countUp('s4',${live.newFunds}); countUp('s5',${live.plannedFunds});`;
  const re = /countUp\('s1',\d+\);\s*countUp\('s2',\d+\);\s*countUp\('s3',\d+\);\s*countUp\('s4',\d+\);\s*countUp\('s5',\d+\);/;
  if (!re.test(idx)) throw new Error('index.html 에서 countUp(s1~s5) 라인을 찾지 못함 (마크업 변경?)');
  idx = idx.replace(re, countLine);

  if (DRY) { console.log('[DRY] 갱신될 stats.json:', next); return; }
  fs.writeFileSync(HTML_PATH, idx);
  fs.writeFileSync(STATS_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log('갱신 완료:', next);
}

main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
