// scripts/dev-server.js - 외부 의존성 없는 초경량 로컬 개발 서버
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 0. .env 파일 자동 로드
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// API 핸들러 모듈 로드
const documentsHandler = require('../api/documents');
const documentDetailHandler = require('../api/document');
const studyLogHandler = require('../api/study-log');
const studyStatsHandler = require('../api/study-stats');

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. API 라우팅
  if (pathname.startsWith('/api/')) {
    // Vercel Serverless 호환 헬퍼 객체 주입
    req.query = parsedUrl.query;
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };

    // Body 파싱 (POST/PUT)
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      if (body) {
        try {
          req.body = JSON.parse(body);
        } catch (e) {
          req.body = {};
        }
      } else {
        req.body = {};
      }

      try {
        if (pathname === '/api/documents') {
          await documentsHandler(req, res);
        } else if (pathname === '/api/document' || pathname.startsWith('/api/documents/')) {
          if (pathname.startsWith('/api/documents/')) {
            const docId = pathname.replace('/api/documents/', '');
            req.query.id = docId;
          }
          await documentDetailHandler(req, res);
        } else if (pathname === '/api/study-log') {
          await studyLogHandler(req, res);
        } else if (pathname === '/api/study-stats') {
          await studyStatsHandler(req, res);
        } else {
          res.status(404).json({ success: false, error: "API 엔드포인트를 찾을 수 없습니다." });
        }
      } catch (handlerErr) {
        console.error('[dev-server] API 에러:', handlerErr);
        res.status(500).json({ success: false, error: handlerErr.message });
      }
    });
    return;
  }

  // 2. 정적 파일 라우팅
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  let filePath = path.join(PUBLIC_DIR, relativePath);

  // SPA fallback
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  serveStatic(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 [Notion Zen Reader] 개발 서버가 가동되었습니다!`);
  console.log(`- 데스크탑 접속 주소: http://localhost:${PORT}`);
  console.log(`- 태블릿(동일 와이파이): http://[PC_로컬_IP]:${PORT}`);
  console.log(`- 기본 PIN 번호: 1234`);
  console.log(`=======================================================`);
});
