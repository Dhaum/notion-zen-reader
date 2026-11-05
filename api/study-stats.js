// api/study-stats.js - 데스크탑 대시보드용 종합 학습 통계 API
const { calculateStats } = require('./lib/storage');
const { verifyZenPin } = require('./lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pin-code, x-zen-pin');
  res.setHeader('Cache-Control', 'no-store');

  // 보안 인증 게이트
  if (!verifyZenPin(req, res)) return;

  try {
    const stats = calculateStats();
    return res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[API /study-stats] 에러:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
