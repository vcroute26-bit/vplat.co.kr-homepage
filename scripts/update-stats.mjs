// vcroute.com 주간 수치 크롤러
// - 홈페이지에서 등록펀드/투자자/활성펀드/모태펀드 수치를 추출
// - index.html 의 해당 수치를 교체하고, data/stats.json 을 갱신
// - "2026년 신생펀드"(newFunds2026)는 공개 크롤 불가라 수동값을 그대로 보존
//
// 실행: node scripts/update-stats.mjs [--dry]

import fs from 'fs';

const DRY = process.argv.includes('--dry');
const SRC = 'https://vcroute.com/';
const STATS_PATH = 'data/stats.json';
const HTML_PATH = 'index.html';

const fmt = (n) => n.toLocaleString('en-US'); // 7053 -> "7,053"

async function main() {
  // 1) vcroute.com 크롤
  const res = await fetch(SRC, { headers: { 'User-Agent': 'vplat-stats-bot/1.0' } });
  if (!res.ok) throw new Error(`fetch 실패: HTTP ${res.status}`);
  const html = await res.text();
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const pick = (re) => {
    const m = text.match(re);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };

  const live = {
    funds:       pick(/([\d,]+)\s*개\s*펀드/),
    investors:   pick(/([\d,]+)\s*개\s*투자자/),
    activeFunds: pick(/활성\s*펀드\s*([\d,]+)/),
    motherFunds: pick(/모태자펀드\s*([\d,]+)/),
  };

  // 2) 검증 (추출 실패 시 중단 — 잘못된 값으로 사이트 훼손 방지)
  for (const [k, v] of Object.entries(live)) {
    if (!Number.isInteger(v) || v <= 0 || v > 1000000) {
      throw new Error(`수치 추출 실패/비정상: ${k}=${v} (사이트 구조 변경 가능)`);
    }
  }
  console.log('크롤 결과:', live);

  // 3) 상태 파일 로드 (신생펀드 등 수동값 보존)
  const cur = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  const next = { ...cur, ...live, updated: new Date().toISOString().slice(0, 10) };

  // 4) index.html 수치 교체 (콤마 표기 old -> new)
  let idx = fs.readFileSync(HTML_PATH, 'utf-8');
  for (const k of ['funds', 'investors', 'activeFunds', 'motherFunds']) {
    if (cur[k] && cur[k] !== live[k]) {
      idx = idx.split(fmt(cur[k])).join(fmt(live[k]));
    }
  }
  // 통계밴드 countUp 정수값 (s4=신생펀드는 수동값 유지)
  idx = idx.replace(
    /countUp\('s1',\d+\);\s*countUp\('s2',\d+\);\s*countUp\('s3',\d+\);\s*countUp\('s4',\d+\);/,
    `countUp('s1',${live.funds}); countUp('s2',${live.investors}); countUp('s3',${live.activeFunds}); countUp('s4',${next.newFunds2026});`
  );

  // 5) 저장
  const changed = idx !== fs.readFileSync(HTML_PATH, 'utf-8') || JSON.stringify(cur) !== JSON.stringify(next);
  if (DRY) {
    console.log('[DRY] 갱신될 stats.json:', next);
    console.log('[DRY] index.html 변경 여부:', changed);
    return;
  }
  fs.writeFileSync(HTML_PATH, idx);
  fs.writeFileSync(STATS_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log('갱신 완료:', next);
}

main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
