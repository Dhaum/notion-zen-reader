// api/document.js - 특정 문서 상세 및 블록 파싱 API
const { getNotionDocumentDetail } = require('./lib/notion');
const { calculateStats } = require('./lib/storage');
const { verifyZenPin } = require('./lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pin-code, x-zen-pin');
  res.setHeader('Cache-Control', 'no-store');

  // 보안 인증 게이트
  if (!verifyZenPin(req, res)) return;

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, error: "문서 ID(id)가 필요합니다." });
  }

  try {
    const forceRefresh = req.query?.refresh === 'true' || req.query?.force === 'true';
    const document = await getNotionDocumentDetail(id, forceRefresh);
    const stats = calculateStats();
    const docStat = stats.docStats[id] || {
      reviewCount: 0,
      lastReviewedAt: null,
      history: []
    };

    return res.status(200).json({
      success: true,
      document: {
        ...document,
        reviewCount: docStat.reviewCount,
        lastReviewedAt: docStat.lastReviewedAt,
        history: docStat.history
      }
    });
  } catch (error) {
    console.error(`[API /document?id=${id}] 에러:`, error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
