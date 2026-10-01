const fs = require('fs');
const path = require('path');

let DatabaseSync;
let dbDriverName = '';

try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
  dbDriverName = 'node:sqlite';
} catch (e1) {
  try {
    DatabaseSync = require('better-sqlite3');
    dbDriverName = 'better-sqlite3';
  } catch (e2) {
    console.warn('[DAP DB] Neither node:sqlite nor better-sqlite3 found directly.');
  }
}

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'dap.db');
const DEFAULT_JSON_PATH = path.join(DEFAULT_DATA_DIR, 'tours.json');

let currentDb = null;

/**
 * SQLite 호환 데이터베이스 인스턴스 생성 및 초기화
 */
function initDatabase(customDbPath = null) {
  const dbPath = customDbPath || process.env.DAP_DB_PATH || DEFAULT_DB_PATH;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!DatabaseSync) {
    throw new Error('SQLite driver not available. Please ensure Node.js >= 22.5.0 or install better-sqlite3.');
  }

  currentDb = new DatabaseSync(dbPath);

  // 테이블 및 인덱스 생성
  currentDb.exec(`
    CREATE TABLE IF NOT EXISTS tours (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL DEFAULT 'default',
      target_url TEXT NOT NULL DEFAULT '/',
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'general',
      version TEXT DEFAULT '1.0.0',
      auto_launch_once INTEGER DEFAULT 0,
      steps_json TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tours_app_url ON tours (app_id, target_url);
  `);

  // 초기 자동 마이그레이션
  autoMigrateFromJson(DEFAULT_JSON_PATH);

  return currentDb;
}

/**
 * tours.json 파일로부터 자동 마이그레이션 수행
 */
function autoMigrateFromJson(jsonFilePath = DEFAULT_JSON_PATH) {
  if (!currentDb) return 0;

  const countRow = currentDb.prepare('SELECT COUNT(*) as count FROM tours').get();
  const count = countRow ? Number(countRow.count) : 0;

  if (count === 0 && fs.existsSync(jsonFilePath)) {
    try {
      const content = fs.readFileSync(jsonFilePath, 'utf8');
      const tours = JSON.parse(content || '[]');
      if (Array.isArray(tours) && tours.length > 0) {
        let insertedCount = 0;
        const insertStmt = currentDb.prepare(`
          INSERT INTO tours (
            id, app_id, target_url, title, description, type, version, auto_launch_once, steps_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of tours) {
          const id = item.id || `tour_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const appId = item.app_id || item.appId || 'default';
          const targetUrl = item.target_url || item.targetUrl || '/';
          const title = item.title || 'Untitled Tour';
          const description = item.description || '';
          const type = item.type || 'general';
          const version = item.version || '1.0.0';
          const autoLaunch = (item.auto_launch_once !== undefined ? item.auto_launch_once : item.autoLaunchOnce) ? 1 : 0;
          const stepsJson = JSON.stringify(item.steps || []);
          const createdAt = item.created_at || item.createdAt || new Date().toISOString();
          const updatedAt = item.updated_at || item.updatedAt || new Date().toISOString();

          insertStmt.run(id, appId, targetUrl, title, description, type, version, autoLaunch, stepsJson, createdAt, updatedAt);
          insertedCount++;
        }

        console.log(`[DAP DB Migration] Successfully migrated ${insertedCount} tours from ${jsonFilePath} to SQLite database (${dbDriverName}).`);
        return insertedCount;
      }
    } catch (err) {
      console.error('[DAP DB Migration] Error during automatic migration:', err);
    }
  }
  return 0;
}

/**
 * DB Row를 프론트엔드 호환 객체로 변환
 */
function rowToTour(row) {
  if (!row) return null;
  let steps = [];
  try {
    steps = typeof row.steps_json === 'string' ? JSON.parse(row.steps_json) : (row.steps_json || []);
  } catch (e) {
    steps = [];
  }

  const isAutoLaunch = Boolean(row.auto_launch_once);

  return {
    id: row.id,
    app_id: row.app_id,
    appId: row.app_id,
    target_url: row.target_url,
    targetUrl: row.target_url,
    title: row.title,
    description: row.description || '',
    type: row.type || 'general',
    version: row.version || '1.0.0',
    auto_launch_once: isAutoLaunch ? 1 : 0,
    autoLaunchOnce: isAutoLaunch,
    steps: steps,
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at
  };
}

/**
 * 투어 목록 조회 (필터링 지원)
 * @param {Object} filter { url, appId }
 */
function getTours(filter = {}) {
  if (!currentDb) initDatabase();

  const url = filter.url || filter.target_url;
  const appId = filter.appId || filter.app_id;

  let sql = 'SELECT * FROM tours';
  const conditions = [];
  const params = [];

  if (url) {
    conditions.push('(target_url = ? OR target_url = \'/\')');
    params.push(url);
  }

  if (appId) {
    conditions.push('app_id = ?');
    params.push(appId);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY created_at ASC';

  const rows = currentDb.prepare(sql).all(...params);
  return rows.map(rowToTour);
}

/**
 * 단일 투어 조회
 */
function getTourById(id) {
  if (!currentDb) initDatabase();
  const row = currentDb.prepare('SELECT * FROM tours WHERE id = ?').get(id);
  return row ? rowToTour(row) : null;
}

/**
 * 투어 저장 (신규 생성 또는 업데이트)
 */
function saveTour(tourData) {
  if (!currentDb) initDatabase();

  const now = new Date().toISOString();
  const appId = tourData.app_id || tourData.appId || 'default';
  const targetUrl = tourData.target_url || tourData.targetUrl || '/';
  const title = (tourData.title || '').trim();
  const description = (tourData.description || '').trim();
  const type = tourData.type || 'general';
  const version = tourData.version || '1.0.0';
  const autoLaunch = (tourData.auto_launch_once !== undefined ? tourData.auto_launch_once : tourData.autoLaunchOnce) ? 1 : 0;
  const stepsJson = JSON.stringify(tourData.steps || []);

  let id = tourData.id;

  if (id) {
    const existing = currentDb.prepare('SELECT id, created_at FROM tours WHERE id = ?').get(id);
    if (existing) {
      // 기존 투어 업데이트
      currentDb.prepare(`
        UPDATE tours SET
          app_id = ?,
          target_url = ?,
          title = ?,
          description = ?,
          type = ?,
          version = ?,
          auto_launch_once = ?,
          steps_json = ?,
          updated_at = ?
        WHERE id = ?
      `).run(appId, targetUrl, title, description, type, version, autoLaunch, stepsJson, now, id);

      return getTourById(id);
    }
  }

  // 신규 투어 생성
  if (!id) {
    id = `tour_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
  const createdAt = tourData.created_at || tourData.createdAt || now;

  currentDb.prepare(`
    INSERT INTO tours (
      id, app_id, target_url, title, description, type, version, auto_launch_once, steps_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, appId, targetUrl, title, description, type, version, autoLaunch, stepsJson, createdAt, now);

  return getTourById(id);
}

/**
 * 투어 삭제
 */
function deleteTour(id) {
  if (!currentDb) initDatabase();

  const tour = getTourById(id);
  if (!tour) return null;

  currentDb.prepare('DELETE FROM tours WHERE id = ?').run(id);
  return tour;
}

/**
 * 데이터베이스 닫기
 */
function closeDatabase() {
  if (currentDb) {
    try {
      currentDb.close();
    } catch (e) {}
    currentDb = null;
  }
}
/**
 * 관리자용 요약 통계 정보 조회
 */
function getAdminStats() {
  if (!currentDb) initDatabase();
  const tours = getTours();
  const appsSet = new Set(tours.map(t => t.appId || t.app_id || 'default'));
  const totalSteps = tours.reduce((acc, t) => acc + (Array.isArray(t.steps) ? t.steps.length : 0), 0);
  const appCounts = {};
  tours.forEach(t => {
    const a = t.appId || t.app_id || 'default';
    appCounts[a] = (appCounts[a] || 0) + 1;
  });
  return {
    totalApps: appsSet.size,
    apps: Array.from(appsSet),
    appCounts,
    totalTours: tours.length,
    totalSteps
  };
}

module.exports = {
  initDatabase,
  autoMigrateFromJson,
  getTours,
  getTourById,
  saveTour,
  deleteTour,
  closeDatabase,
  getAdminStats,
  rowToTour,
  getDriverName: () => dbDriverName
};
