// api/lib/auth.js - 4자리 Zen PIN 인증 미들웨어 및 보안 게이트
/**
 * 요청의 PIN 번호를 검증합니다.
 * - 헤더: x-zen-pin 또는 x-pin-code
 * - 쿼리스트링: pin
 * - OPTIONS 사전 요청(Preflight)은 200 통과
 * 
 * @param {import('http').IncomingMessage} req 
 * @param {import('http').ServerResponse} res 
 * @returns {boolean} 인증 통과 여부 (통과 시 true, 실패/OPTIONS 시 false 및 응답 전송)
 */
function verifyZenPin(req, res) {
  // CORS 공통 헤더 설정 보장
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pin-code, x-zen-pin');
  }

  // 1. OPTIONS 사전 요청(Preflight)은 200 통과 및 핸들러 즉시 종료
  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      res.status(200).end();
    } else {
      res.statusCode = 200;
      res.end();
    }
    return false;
  }

  // 2. PIN 코드 추출 (헤더 x-zen-pin, x-pin-code 대소문자 무관 탐색 + 쿼리스트링 pin)
  const headers = req.headers || {};
  let pinFromHeader = headers['x-zen-pin'] || headers['x-pin-code'];

  if (!pinFromHeader) {
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-zen-pin' || lower === 'x-pin-code') {
        pinFromHeader = value;
        break;
      }
    }
  }

  let pinFromQuery = req.query ? req.query.pin : null;
  if (!pinFromQuery && req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      pinFromQuery = parsed.searchParams.get('pin');
    } catch (e) {
      // url 파싱 실패 시 무시
    }
  }

  const clientPin = (pinFromHeader || pinFromQuery || '').toString().trim();
  const expectedPin = (process.env.PIN_CODE || '1234').toString().trim();

  // 3. 일치 여부 대조
  if (!clientPin || clientPin !== expectedPin) {
    const errorPayload = {
      success: false,
      error: '인증 실패: 올바른 PIN 번호가 필요합니다.'
    };

    if (typeof res.status === 'function' && typeof res.json === 'function') {
      res.status(401).json(errorPayload);
    } else {
      res.statusCode = 401;
      if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(errorPayload));
    }
    return false;
  }

  return true;
}

module.exports = {
  verifyZenPin
};
