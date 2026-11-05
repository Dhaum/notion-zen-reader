// api/documents.js - 노션 지식 DB 문서 목록 API (각 문서별 복습 현황 융합)
const { getNotionDocuments } = require('./lib/notion');
const { calculateStats } = require('./lib/storage');
const { verifyZenPin } = require('./lib/auth');

module.exports = async function handler(req, res) {
  // CORS & 캐시 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pin-code, x-zen-pin');
  res.setHeader('Cache-Control', 'no-store');

  // 보안 인증 게이트
  if (!verifyZenPin(req, res)) return;

  try {
    const forceRefresh = req.query?.refresh === 'true' || req.query?.force === 'true';
    const documents = await getNotionDocuments(forceRefresh);
    const stats = calculateStats();

    // 각 문서에 독립 저장소의 복습 횟수 및 마지막 복습일 결합
    const mergedDocs = documents.map(doc => {
      const docStat = stats.docStats[doc.id] || {
        reviewCount: 0,
        lastReviewedAt: null
      };

      return {
        ...doc,
        reviewCount: docStat.reviewCount,
        lastReviewedAt: docStat.lastReviewedAt
      };
    });

    return res.status(200).json({
      success: true,
      count: mergedDocs.length,
      documents: mergedDocs
    });
  } catch (error) {
    console.error('[API /documents] 에러:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
