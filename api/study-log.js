// api/study-log.js - 학습 체크인 기록 수집 API (노션 원본 무손상)
const { saveLog, readAllLogs } = require('./lib/storage');
const { verifyZenPin } = require('./lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pin-code, x-zen-pin');
  res.setHeader('Cache-Control', 'no-store');

  // 보안 인증 게이트
  if (!verifyZenPin(req, res)) return;

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const { docId, docTitle, durationSeconds, reviewCount, feedback, readAt, timestamp, device } = body;

      if (!docId) {
        return res.status(400).json({ success: false, error: "docId가 누락되었습니다." });
      }

      const saved = saveLog({
        docId,
        docTitle: docTitle || "제목 없음",
        durationSeconds: durationSeconds || 60,
        reviewCount: reviewCount || 1,
        feedback: feedback || "good",
        readAt: readAt || timestamp || new Date().toISOString(),
        device: device || "alldocube-tablet"
      });

      console.log(`[study-tracker] 체크인 완료: ${docTitle} (${docId}) - ${saved.durationSeconds}초, ${saved.feedback}`);

      return res.status(200).json({
        success: true,
        message: "학습 기록이 저장되었습니다.",
        log: saved
      });
    } catch (error) {
      console.error('[API /study-log POST] 에러:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET: 최근 로그 조회
  try {
    const logs = readAllLogs();
    return res.status(200).json({
      success: true,
      count: logs.length,
      logs: logs.slice(0, 50)
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
