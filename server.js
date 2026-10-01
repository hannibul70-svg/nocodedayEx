const fs = require('fs');
const path = require('path');
const http = require('http');
const db = require('./db/database');

const PORT = process.env.PORT || 3050;
const PUBLIC_DIR = path.join(__dirname, 'public');

// SQLite 데이터베이스 초기화 및 tours.json 자동 마이그레이션 보장
db.initDatabase();

// 유효성 검사 헬퍼
function validateTourInput(body) {
  const { title, steps } = body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return '투어 제목(title)은 필수입니다.';
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    return '최소 1개 이상의 스텝(steps)이 필요합니다.';
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.element || typeof step.element !== 'string') {
      return `스텝 ${i + 1}: 대상 요소(element) 셀렉터가 누락되었습니다.`;
    }
    if (!step.popover || !step.popover.title) {
      return `스텝 ${i + 1}: 팝오버 제목(popover.title)이 누락되었습니다.`;
    }
  }

  return null;
}

// MIME types for static server fallback
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

let serverInstance = null;

// Express 사용 가능 여부 확인
try {
  const express = require('express');
  const cors = require('cors');

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static files serving
  app.use(express.static(PUBLIC_DIR));

  // Admin Portal route: GET /admin
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });

  // Admin Stats API: GET /api/admin/stats
  app.get('/api/admin/stats', (req, res) => {
    try {
      const stats = db.getAdminStats();
      res.json(stats);
    } catch (err) {
      console.error('Error fetching admin stats:', err);
      res.status(500).json({ error: '관리자 통계 조회 중 오류가 발생했습니다.' });
    }
  });

  // REST API: GET /api/tours & GET /api/guides
  app.get(['/api/tours', '/api/guides'], (req, res) => {
    try {
      const url = req.query.url || req.query.target_url;
      const appId = req.query.appId || req.query.app_id;
      const tours = db.getTours({ url, appId });
      res.json(tours);
    } catch (err) {
      console.error('Error fetching tours:', err);
      res.status(500).json({ error: '투어 목록 조회 중 오류가 발생했습니다.' });
    }
  });

  // REST API: POST /api/tours
  app.post('/api/tours', (req, res) => {
    const validationError = validateTourInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    try {
      const savedTour = db.saveTour(req.body);
      res.status(201).json(savedTour);
    } catch (err) {
      console.error('Error saving tour:', err);
      res.status(500).json({ error: '투어 저장 중 오류가 발생했습니다.' });
    }
  });

  // REST API: DELETE /api/tours/:id
  app.delete('/api/tours/:id', (req, res) => {
    try {
      const { id } = req.params;
      const deletedTour = db.deleteTour(id);

      if (!deletedTour) {
        return res.status(404).json({ error: '해당 ID의 투어를 찾을 수 없습니다.' });
      }

      res.json({ message: '투어가 성공적으로 삭제되었습니다.', deletedTour });
    } catch (err) {
      console.error('Error deleting tour:', err);
      res.status(500).json({ error: '투어 삭제 중 오류가 발생했습니다.' });
    }
  });

  // Server listen
  serverInstance = app.listen(PORT, () => {
    console.log(`[DAP Express Server] Running on http://localhost:${PORT} (${db.getDriverName()})`);
  });

} catch (e) {
  // Express 미설치 환경 대비: Node.js 내장 http 서버로 100% 동일한 기능 Fallback 서빙
  console.log('[Notice] Express is not installed yet. Running on Node.js built-in HTTP server fallback.');

  serverInstance = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Admin Portal route
    if (pathname === '/admin' && req.method === 'GET') {
      const adminPath = path.join(PUBLIC_DIR, 'admin.html');
      fs.readFile(adminPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
          res.end('404 Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(data);
      });
      return;
    }

    // Admin Stats API: GET /api/admin/stats
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      try {
        const stats = db.getAdminStats();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify(stats));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ error: '관리자 통계 조회 중 오류가 발생했습니다.' }));
      }
      return;
    }

    // API Routes: GET /api/tours & GET /api/guides
    if ((pathname === '/api/tours' || pathname === '/api/guides') && req.method === 'GET') {
      const url = parsedUrl.searchParams.get('url') || parsedUrl.searchParams.get('target_url') || undefined;
      const appId = parsedUrl.searchParams.get('appId') || parsedUrl.searchParams.get('app_id') || undefined;
      const tours = db.getTours({ url, appId });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(tours));
      return;
    }

    if (pathname === '/api/tours' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsedBody = JSON.parse(body || '{}');
          const validationError = validateTourInput(parsedBody);
          if (validationError) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
            res.end(JSON.stringify({ error: validationError }));
            return;
          }

          const savedTour = db.saveTour(parsedBody);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify(savedTour));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ error: '잘못된 JSON 형식입니다.' }));
        }
      });
      return;
    }

    if (pathname.startsWith('/api/tours/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.substring('/api/tours/'.length));
      const deletedTour = db.deleteTour(id);

      if (!deletedTour) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ error: '해당 ID의 투어를 찾을 수 없습니다.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ message: '투어가 성공적으로 삭제되었습니다.', deletedTour }));
      return;
    }

    // Static Files Serving
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    });
  });

  serverInstance.listen(PORT, () => {
    console.log(`[DAP Fallback HTTP Server] Running on http://localhost:${PORT} (${db.getDriverName()})`);
  });
}

module.exports = serverInstance;
