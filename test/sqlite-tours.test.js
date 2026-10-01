/**
 * DAP SQLite Database & Tours API Unit / Integration Test
 */
const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 3099;
process.env.PORT = TEST_PORT;

// 테스트 전용 격리 DB 경로 지정
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test_dap.db');
process.env.DAP_DB_PATH = TEST_DB_PATH;

// 이전 테스트 DB 잔여물이 있다면 제거
if (fs.existsSync(TEST_DB_PATH)) {
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
}

const db = require('../db/database');

console.log('--- Starting DAP SQLite & Tours API Unit / Integration Tests ---');
console.log('Driver in use:', db.getDriverName() || 'node:sqlite');
console.log('Test DB Path:', TEST_DB_PATH);

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
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      if (err.stack) {
        console.error(err.stack);
      }
      failed++;
    }
  }

  // 1. SQLite DB 초기화 및 마이그레이션 단위 검증
  await test('1. SQLite DB Initialization and tours.json Migration', async () => {
    const dbInstance = db.initDatabase(TEST_DB_PATH);
    assert(dbInstance, 'Database instance must be initialized');

    // 테이블 생성 여부 확인
    const tableInfo = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tours'").get();
    assert(tableInfo, 'Table "tours" must exist in sqlite_master');

    // 인덱스 생성 여부 확인
    const indexInfo = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tours_app_url'").get();
    assert(indexInfo, 'Index "idx_tours_app_url" must exist');

    // data/tours.json 마이그레이션 결과 확인 (기존 3개 투어)
    const tours = db.getTours();
    assert(Array.isArray(tours), 'getTours must return an array');
    assert(tours.length >= 3, `Expected at least 3 migrated tours, found: ${tours.length}`);

    const portalTour = tours.find(t => t.id === 'tour-portal-onboarding');
    assert(portalTour, 'tour-portal-onboarding must be migrated');
    assert.strictEqual(portalTour.app_id, 'default');
    assert.strictEqual(portalTour.target_url, '/');
    assert(Array.isArray(portalTour.steps), 'steps should be parsed into an array');
    assert.strictEqual(portalTour.steps.length, 5);

    const whatsNewTour = tours.find(t => t.id === 'tour-whats-new-v12');
    assert(whatsNewTour, 'tour-whats-new-v12 must be migrated');
    assert.strictEqual(whatsNewTour.autoLaunchOnce, true);
  });

  // 2. HTTP 서버 구동
  const server = require('../server.js');
  await new Promise(r => setTimeout(r, 600));

  // 3. GET /api/tours 전체 조회 검증
  await test('2. GET /api/tours returns all migrated tours (200)', async () => {
    const res = await request({ path: '/api/tours', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.json), 'Response body must be an array');
    assert(res.json.length >= 3, 'Response should contain at least 3 tours');
    const first = res.json[0];
    assert(first.id, 'Tour must have an id');
    assert(Array.isArray(first.steps), 'Tour must have steps array');
  });

  // 4. POST /api/tours 유효성 검사 (Validation)
  await test('3. POST /api/tours validation: title and steps required (400)', async () => {
    const noTitleRes = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { title: '', steps: [{ element: '#header', popover: { title: '안내' } }] }
    );
    assert.strictEqual(noTitleRes.statusCode, 400);
    assert(noTitleRes.json && noTitleRes.json.error, 'Must return error on empty title');

    const emptyStepsRes = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { title: '테스트 투어', steps: [] }
    );
    assert.strictEqual(emptyStepsRes.statusCode, 400);

    const invalidStepRes = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { title: '테스트 투어', steps: [{ element: '' }] }
    );
    assert.strictEqual(invalidStepRes.statusCode, 400);
  });

  // 5. POST /api/tours 신규 생성 (target_url, app_id 포함)
  let createdTourId = null;
  await test('4. POST /api/tours creates a new tour with target_url and app_id (201)', async () => {
    const newTourPayload = {
      title: '주문 관리 가이드',
      description: '주문 페이지의 필터 및 엑셀 다운로드를 안내합니다.',
      target_url: '/orders',
      app_id: 'enterprise-app',
      type: 'page-guide',
      version: '1.1.0',
      auto_launch_once: 1,
      steps: [
        {
          element: '#order-filter',
          popover: { title: '주문 상태 필터', description: '주문 상태별로 정렬합니다.', side: 'bottom' }
        },
        {
          element: '#btn-download-csv',
          popover: { title: 'CSV 다운로드', description: '목록을 CSV로 저장합니다.', side: 'top' }
        }
      ]
    };

    const res = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      newTourPayload
    );

    assert.strictEqual(res.statusCode, 201);
    assert(res.json && res.json.id, 'Created tour must have an ID');
    assert.strictEqual(res.json.title, newTourPayload.title);
    assert.strictEqual(res.json.target_url, '/orders');
    assert.strictEqual(res.json.app_id, 'enterprise-app');
    assert.strictEqual(res.json.steps.length, 2);
    assert.strictEqual(res.json.autoLaunchOnce, true);

    createdTourId = res.json.id;
  });

  // 6. GET /api/tours?url=... 및 ?appId=... URL 필터링 검증
  await test('5. GET /api/tours?url=/orders&appId=enterprise-app filters tours correctly', async () => {
    const res = await request({ path: '/api/tours?url=/orders&appId=enterprise-app', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    assert(Array.isArray(res.json), 'Response body must be an array');

    // /orders 전용 투어 및 target_url이 '/'인 공통 투어가 포함되어야 함
    const foundCreated = res.json.find(t => t.id === createdTourId);
    assert(foundCreated, 'Created tour for /orders must be included in the response');

    // 다른 URL 전용 투어가 잘못 섞이지 않았는지 확인
    for (const tour of res.json) {
      assert(tour.target_url === '/orders' || tour.target_url === '/', `Unexpected target_url: ${tour.target_url}`);
      assert.strictEqual(tour.app_id, 'enterprise-app', `Unexpected app_id: ${tour.app_id}`);
    }
  });

  // 7. GET /api/tours?url=/analytics - /orders 투어가 포함되지 않는지 확인
  await test('6. GET /api/tours?url=/analytics excludes /orders specific tour', async () => {
    const res = await request({ path: '/api/tours?url=/analytics', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    const foundCreated = res.json.find(t => t.id === createdTourId);
    assert.strictEqual(foundCreated, undefined, 'Created tour for /orders must not be in /analytics query');
  });

  // 8. POST /api/tours 기존 투어 업데이트 검증
  await test('7. POST /api/tours with existing ID updates the tour (201)', async () => {
    assert(createdTourId, 'createdTourId must exist');
    const updatePayload = {
      id: createdTourId,
      title: '주문 관리 가이드 (수정됨)',
      description: '업데이트된 설명입니다.',
      target_url: '/orders',
      app_id: 'enterprise-app',
      steps: [
        {
          element: '#order-filter',
          popover: { title: '개선된 필터', description: '새로운 필터 안내입니다.', side: 'bottom' }
        }
      ]
    };

    const res = await request(
      { path: '/api/tours', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      updatePayload
    );

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.json.id, createdTourId);
    assert.strictEqual(res.json.title, '주문 관리 가이드 (수정됨)');
    assert.strictEqual(res.json.steps.length, 1);
  });

  // 9. DELETE /api/tours/:id 삭제 검증
  await test('8. DELETE /api/tours/:id deletes the tour (200)', async () => {
    const res = await request({ path: `/api/tours/${createdTourId}`, method: 'DELETE' });
    assert.strictEqual(res.statusCode, 200);
    assert(res.json && res.json.deletedTour, 'Response should contain deletedTour');
    assert.strictEqual(res.json.deletedTour.id, createdTourId);

    // 삭제 후 조회 시 미존재 확인
    const checkRes = await request({ path: '/api/tours', method: 'GET' });
    const found = checkRes.json.find(t => t.id === createdTourId);
    assert.strictEqual(found, undefined, 'Deleted tour must not be found');
  });

  // 10. DELETE /api/tours/:id 존재하지 않는 투어 삭제 시 404 반환
  await test('9. DELETE /api/tours/non-existent returns 404', async () => {
    const res = await request({ path: '/api/tours/non-existent-tour-999', method: 'DELETE' });
    assert.strictEqual(res.statusCode, 404);
  });

  // 정리 (Cleanup)
  if (server && typeof server.close === 'function') {
    server.close();
  }
  db.closeDatabase();

  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
  }

  console.log(`\n========================================`);
  console.log(`Test Results: Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
