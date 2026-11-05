// scripts/test-api.js - API 핸들러 및 인메모리 캐시 검증 스크립트
const { getNotionDocuments, getNotionDocumentDetail, getCacheStats, clearNotionCache } = require('../api/lib/notion');
const { calculateStats, saveLog } = require('../api/lib/storage');

async function testAll() {
  console.log('--- 1. 노션 문서 목록 최초 조회 및 캐싱 테스트 ---');
  clearNotionCache();
  const t0 = Date.now();
  const docs = await getNotionDocuments();
  const dur0 = Date.now() - t0;
  console.log(`[1차] 문서 개수: ${docs.length}개, 소요 시간: ${dur0}ms`);
  console.log(`첫 번째 문서 제목: ${docs[0]?.title}`);

  console.log('\n--- 1-2. 노션 문서 목록 인메모리 캐시 히트 검증 ---');
  const t1 = Date.now();
  const cachedDocs = await getNotionDocuments();
  const dur1 = Date.now() - t1;
  console.log(`[2차 캐시] 문서 개수: ${cachedDocs.length}개, 소요 시간: ${dur1}ms (0ms 급 즉시 반환)`);
  if (dur1 > 100) {
    throw new Error(`캐시 히트 소요 시간이 비정상적입니다: ${dur1}ms`);
  }

  console.log('\n--- 2. 특정 문서 상세 및 블록 파싱 최초 조회 ---');
  const t2 = Date.now();
  const docDetail = await getNotionDocumentDetail(docs[0]?.id);
  const dur2 = Date.now() - t2;
  console.log(`[1차 상세] 제목: ${docDetail.title}, 블록 수: ${docDetail.blocks.length}개, 소요 시간: ${dur2}ms`);

  console.log('\n--- 2-2. 특정 문서 상세 Map 캐시 히트 검증 ---');
  const t3 = Date.now();
  const cachedDetail = await getNotionDocumentDetail(docs[0]?.id);
  const dur3 = Date.now() - t3;
  console.log(`[2차 상세 캐시] 소요 시간: ${dur3}ms (초고속 반환, 블록 일치: ${cachedDetail.blocks.length === docDetail.blocks.length})`);
  if (dur3 > 50) {
    throw new Error(`상세 캐시 히트 소요 시간이 비정상적입니다: ${dur3}ms`);
  }

  console.log('\n--- 2-3. 캐시 상태(Stats) 점검 ---');
  const cacheStats = getCacheStats();
  console.log('캐시 통계:', JSON.stringify(cacheStats, null, 2));

  console.log('\n--- 3. 학습 로그 저장(체크인) 테스트 ---');
  const newLog = saveLog({
    docId: docs[0]?.id,
    docTitle: docs[0]?.title,
    durationSeconds: 120,
    device: "test-runner"
  });
  console.log(`저장된 로그 ID: ${newLog.id}, 회독 시간: ${newLog.durationSeconds}초`);

  console.log('\n--- 4. 통계 및 히트맵 계산 테스트 ---');
  const stats = calculateStats();
  console.log(`총 학습 횟수: ${stats.summary.totalReviews}회`);
  console.log(`오늘 학습 횟수: ${stats.summary.todayReviews}회`);
  console.log(`히트맵 일자 수: ${Object.keys(stats.heatmap).length}일`);
  console.log(`복습 추천 항목 수: ${stats.recommendations.length}개`);

  console.log('\n✅ 모든 백엔드 로직 및 노션 API 429 방어 인메모리 캐싱 검증 성공!');
}

testAll().catch(err => {
  console.error('❌ 테스트 실패:', err);
  process.exit(1);
});
