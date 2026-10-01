/**
 * DAP Server & Tours API Unit / Integration Test
 */
const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 3001;
process.env.PORT = TEST_PORT;

// server.js 모듈 로드 및 포트 확인
console.log('--- Starting DAP API Unit Tests on Port', TEST_PORT, '---');

// 테스트용 임시 tours 데이터 백업 및 복원 준비
const TOURS_FILE = path.join(__dirname, '..', 'data', 'tours.json');
let originalData = '[]';
if (fs.existsSync(TOURS_FILE)) {
  originalData = fs.readFileSync(TOURS_FILE, 'utf8');
}

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
          json: json
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  // server.js 로드하여 서버 기동
  require('../server.js');

  // 서버가 기동될 때까지 약간 대기
  await new Promise(r => setTimeout(r, 500));

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. GET /api/tours 초기 목록 조회
  await test('GET /api/tours should return 200 and an array', async () => {
    const res = await request({ path: '/api/tours', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.json), 'Response should be an array');
  });

  // 2. POST /api/tours 유효성 검사 (제목 누락)
  await test('POST /api/tours without title should return 400 Bad Request', async () => {
    const res = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { title: '', steps: [{ element: '#test', popover: { title: 'Test' } }] }
    );
    assert.strictEqual(res.statusCode, 400);
    assert(res.json && res.json.error, 'Should contain error message');
  });

  // 3. POST /api/tours 유효성 검사 (스텝 누락)
  await test('POST /api/tours with empty steps should return 400 Bad Request', async () => {
    const res = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { title: 'Invalid Tour', steps: [] }
    );
    assert.strictEqual(res.statusCode, 400);
  });

  // 4. POST /api/tours 정상 생성 테스트
  let createdTourId = null;
  await test('POST /api/tours with valid payload should create a tour (201)', async () => {
    const newTour = {
      title: '단위 테스트 투어',
      description: '단위 테스트를 위해 생성된 온보딩 가이드입니다.',
      steps: [
        {
          element: '#header-search',
          popover: { title: '검색 기능', description: '검색을 수행합니다.', side: 'bottom' }
        },
        {
          element: '#btn-create-order',
          popover: { title: '주문 생성', description: '주문을 등록합니다.', side: 'left' }
        }
      ]
    };
    const res = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      newTour
    );
    assert.strictEqual(res.statusCode, 201);
    assert(res.json && res.json.id, 'Created tour must have an ID');
    assert.strictEqual(res.json.title, newTour.title);
    assert.strictEqual(res.json.steps.length, 2);
    createdTourId = res.json.id;
  });

  // 5. DELETE /api/tours/:id 삭제 테스트
  await test('DELETE /api/tours/:id should delete the tour (200)', async () => {
    assert(createdTourId, 'createdTourId must exist');
    const res = await request({ path: `/api/tours/${createdTourId}`, method: 'DELETE' });
    assert.strictEqual(res.statusCode, 200);
    assert(res.json && res.json.deletedTour, 'Response should contain deletedTour');
  });

  // 6. 삭제 후 GET /api/tours 확인
  await test('GET /api/tours should not contain the deleted tour', async () => {
    const res = await request({ path: '/api/tours', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    const found = res.json.find(t => t.id === createdTourId);
    assert.strictEqual(found, undefined, 'Deleted tour should not be present');
  });

  // 7. 정적 파일 서빙 GET /index.html
  await test('GET /index.html should serve static dashboard HTML (200)', async () => {
    const res = await request({ path: '/index.html', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    assert(res.data.includes('DAP Enterprise Portal'), 'HTML must contain title');
    assert(res.data.includes('driver.js'), 'HTML must load Driver.js');
  });

  // 테스트 종료 후 원본 파일 복원
  fs.writeFileSync(TOURS_FILE, originalData, 'utf8');

  console.log(`\n========================================`);
  console.log(`Test Results: Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
