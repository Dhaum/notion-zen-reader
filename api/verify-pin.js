// api/verify-pin.js - 클라이언트 PIN 번호 검증 전용 경량 엔드포인트
const { verifyZenPin } = require('./lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pin-code, x-zen-pin');
  res.setHeader('Cache-Control', 'no-store');

  // 보안 인증 미들웨어 (일치하지 않으면 401 반환)
  if (!verifyZenPin(req, res)) return;

  return res.status(200).json({
    success: true,
    message: '인증 완료'
  });
};
