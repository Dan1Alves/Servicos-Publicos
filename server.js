const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

let SQL;
let memoryDb;
const db = {
  prepare(sql) {
    return createStatement(sql);
  }
};

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trocar_essa_chave_localmente';
const DEFAULT_CITY_SLUG = process.env.DEFAULT_CITY || 'cidade-modelo';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const dbFile = path.join(__dirname, 'data.db');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype || !/(png|jpe?g|webp)$/i.test(file.mimetype)) {
      return cb(new Error('Apenas imagens PNG, JPG ou WEBP sao permitidas'));
    }
    cb(null, true);
  }
});

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

app.get('/login', (_, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos envios em sequencia. Por favor tente novamente mais tarde.' }
});

const STATUS_LABELS = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  resolvido: 'Resolvido'
};

const ALLOWED_STATUSES = Object.keys(STATUS_LABELS);

function createStatement(sql) {
  return {
    all: (...params) => execAll(sql, params),
    get: (...params) => execGet(sql, params),
    run: (...params) => execRun(sql, params)
  };
}

function execAll(sql, params = []) {
  ensureDbReady();
  const stmt = memoryDb.prepare(sql);
  bindParams(stmt, params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function execGet(sql, params = []) {
  ensureDbReady();
  const stmt = memoryDb.prepare(sql);
  bindParams(stmt, params);
  let row;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function execRun(sql, params = []) {
  ensureDbReady();
  const stmt = memoryDb.prepare(sql);
  bindParams(stmt, params);
  stmt.step();
  stmt.free();
  const info = {
    lastInsertRowid: getScalar('SELECT last_insert_rowid() as value'),
    changes: getScalar('SELECT changes() as value')
  };
  persistDb();
  return info;
}

function bindParams(stmt, params = []) {
  if (!params || !params.length) return;
  const normalized = params.map((param) => (param === undefined ? null : param));
  stmt.bind(normalized);
}

function getScalar(sql) {
  ensureDbReady();
  const result = memoryDb.exec(sql);
  if (result && result[0] && result[0].values && result[0].values[0]) {
    return result[0].values[0][0];
  }
  return null;
}

function persistDb() {
  if (!memoryDb) return;
  const data = memoryDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbFile, buffer);
}

function loadDatabase() {
  if (fs.existsSync(dbFile)) {
    const fileBuffer = fs.readFileSync(dbFile);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
}

function ensureDbReady() {
  if (!memoryDb) {
    throw new Error('Database not initialized');
  }
}

function initDb() {
  db.prepare('PRAGMA foreign_keys = ON').run();
  db.prepare(`CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    default_lat REAL NOT NULL,
    default_lng REAL NOT NULL,
    default_zoom INTEGER DEFAULT 13,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS districts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(city_id, name),
    FOREIGN KEY(city_id) REFERENCES cities(id) ON DELETE CASCADE
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS streets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    district_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(district_id, name),
    FOREIGN KEY(district_id) REFERENCES districts(id) ON DELETE CASCADE
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'active',
    description TEXT,
    order_index INTEGER DEFAULT 0,
    city_scope TEXT DEFAULT 'global'
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_uid TEXT UNIQUE,
    city_id INTEGER NOT NULL,
    district_id INTEGER,
    street_id INTEGER,
    rua TEXT,
    bairro TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(city_id) REFERENCES cities(id) ON DELETE CASCADE,
    FOREIGN KEY(district_id) REFERENCES districts(id),
    FOREIGN KEY(street_id) REFERENCES streets(id)
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol TEXT UNIQUE NOT NULL,
    service_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    city_id INTEGER NOT NULL,
    district_id INTEGER,
    bairro TEXT,
    rua TEXT,
    type TEXT NOT NULL,
    description TEXT,
    image TEXT,
    ip TEXT,
    browser_lat REAL,
    browser_lng REAL,
    status TEXT DEFAULT 'aberto',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    resolution_minutes INTEGER,
    history TEXT,
    origin TEXT DEFAULT 'portal',
    FOREIGN KEY(service_id) REFERENCES services(id),
    FOREIGN KEY(post_id) REFERENCES posts(id),
    FOREIGN KEY(city_id) REFERENCES cities(id)
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS report_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    city_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(city_id) REFERENCES cities(id)
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS institutional_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();

  ensureColumn('posts', 'ativo', 'INTEGER DEFAULT 1');
  ensureColumn('posts', 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  ensureColumn('posts', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  ensureColumn('reports', 'browser_lat', 'REAL');
  ensureColumn('reports', 'browser_lng', 'REAL');
  ensureColumn('reports', 'resolved_at', 'TEXT');
  ensureColumn('reports', 'resolution_minutes', 'INTEGER');
  ensureColumn('reports', 'origin', "TEXT DEFAULT 'portal'");
  ensureColumn('reports', 'history', 'TEXT');
  ensureColumn('reports', 'district_id', 'INTEGER');
  ensureColumn('reports', 'bairro', 'TEXT');
  ensureColumn('reports', 'rua', 'TEXT');
  ensureColumn('posts', 'district_id', 'INTEGER');
  ensureColumn('posts', 'street_id', 'INTEGER');
  ensureColumn('users', 'city_id', 'INTEGER');

  db.prepare('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_reports_city ON reports(city_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_posts_city ON posts(city_id)').run();

  seedCities();
  seedDistricts();
  seedServices();
  seedUsers();
  seedBranding();
  seedPosts();
  normalizeStatuses();
  bindAdminsToDefaultCity();
}

function ensureColumn(table, column, definition) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!info.some(col => col.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function seedCities() {
  const count = db.prepare('SELECT COUNT(*) as total FROM cities').get().total;
  if (count === 0) {
    db.prepare('INSERT INTO cities (name, slug, default_lat, default_lng, default_zoom, active) VALUES (?,?,?,?,?,1)')
      .run('Cidade Modelo', 'cidade-modelo', -23.55052, -46.633308, 13);
  }
}

function seedDistricts() {
  const city = getCityBySlug(DEFAULT_CITY_SLUG) || db.prepare('SELECT * FROM cities LIMIT 1').get();
  if (!city) return;
  const existing = db.prepare('SELECT COUNT(*) as total FROM districts WHERE city_id = ?').get(city.id).total;
  if (existing > 0) return;
  const names = ['Centro', 'Zona Norte', 'Zona Sul', 'Bairro Alto'];
  const stmt = db.prepare('INSERT INTO districts (city_id, name) VALUES (?, ?)');
  names.forEach(name => stmt.run(city.id, name));
}

function seedServices() {
  const existing = db.prepare('SELECT COUNT(*) as total FROM services').get().total;
  if (existing === 0) {
    const stmt = db.prepare('INSERT INTO services (name, slug, status, description, order_index) VALUES (?,?,?,?,?)');
    stmt.run('Iluminacao Publica', 'iluminacao-publica', 'active', 'Monitoramento de postes e lampadas municipais.', 1);
    stmt.run('Buracos na Rua', 'buracos-na-rua', 'upcoming', 'Canal preparado para solicitacoes de tapa buraco.', 2);
    stmt.run('Vazamentos', 'vazamentos', 'upcoming', 'Fluxo para denuncias de agua e esgoto.', 3);
    stmt.run('Lixo Acumulado', 'lixo-acumulado', 'upcoming', 'Gestao de residuos solidos e pontos viciados.', 4);
    stmt.run('Sinalizacao Danificada', 'sinalizacao-danificada', 'upcoming', 'Controle de placas e semaforos.', 5);
  }
}

function seedUsers() {
  const total = db.prepare('SELECT COUNT(*) as total FROM users').get().total;
  if (total === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const devHash = bcrypt.hashSync('dev123', 10);
    const defaultCity = getDefaultCity();
    const adminCityId = defaultCity?.id || null;
    const stmt = db.prepare('INSERT INTO users (username, password_hash, role, city_id) VALUES (?,?,?,?)');
    stmt.run('admin', adminHash, 'admin', adminCityId);
    stmt.run('dev', devHash, 'dev', null);
  }
}

function bindAdminsToDefaultCity() {
  const defaultCity = getDefaultCity();
  if (!defaultCity) return;
  db.prepare("UPDATE users SET city_id = ? WHERE role = 'admin' AND (city_id IS NULL OR city_id = 0)")
    .run(defaultCity.id);
}

function seedBranding() {
  const defaults = {
    organization: 'Prefeitura Municipal de Cidade Modelo',
    cityName: 'Cidade Modelo',
    primaryColor: '#0f2d45',
    secondaryColor: '#1c3a54',
    accentColor: '#e8eef6',
    neutralColor: '#ffffff',
    pageBackground: '#f4f6fb',
    heroBackground: 'linear-gradient(135deg,#0b253f,#1c3b61)',
    loginBackground: '#0f253c',
    heroImage: null,
    heroTitle: 'Gestao Urbana Integrada',
    heroSubtitle: 'Monitoramento institucional da iluminacao publica com foco em resposta rapida.',
    inlineHelperText: 'Escolha um poste no mapa e clique em "Preencher denuncia".',
    inlineButtonText: 'Preencher denuncia',
    inlineCardTitle: 'Poste selecionado',
    inlineEmptyText: 'Nenhum poste selecionado',
    drawerTipText: 'Selecione "Reportar problema" para registrar a ocorrencia. As coordenadas sao automaticas.',
    serviceModalTitle: 'Escolha um servico para iniciar',
    serviceModalSubtitle: 'Somente Iluminacao Publica esta liberada. Os demais modulos chegarao em breve.',
    serviceModalOverlay: 'rgba(5, 12, 24, 0.65)',
    serviceModalBackground: '#ffffff',
    serviceModalBorderColor: 'rgba(8, 15, 26, 0.08)',
    reportModalTitle: 'Registrar iluminacao publica',
    reportModalDescription: 'Selecione um poste no mapa para preencher os dados automaticamente.',
    reportSubmitLabel: 'Enviar denuncia',
    cardBackground: '#ffffff',
    cardBorderColor: '#dfe7f3',
    inlineCardBackground: 'rgba(255, 255, 255, 0.12)',
    inlineCardBorder: 'rgba(255, 255, 255, 0.3)',
    inlineCardTextColor: '#ffffff',
    inlineCardMutedColor: 'rgba(255, 255, 255, 0.75)',
    inlineCardButtonBorder: 'rgba(255, 255, 255, 0.65)',
    drawerBackground: '#ffffff',
    drawerTextColor: '#0f253c',
    modalBackground: '#ffffff',
    modalTextColor: '#0f253c',
    mapStyleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    heroCta: {
      text: '',
      link: ''
    },
    homeImages: [],
    loginImage: null,
    aboutText: 'Plataforma oficial da prefeitura para gestao urbana, preparada para novos modulos.',
    transparencyText: 'Os dados publicos sao atualizados continuamente para garantir transparencia.',
    contact: {
      email: 'gestaourbana@prefeitura.gov.br',
      phone: '0800-000-2026',
      whatsapp: '+55 11 99999-0000'
    }
  };
  const row = db.prepare('SELECT payload FROM institutional_settings WHERE id = 1').get();
  if (!row) {
    saveBranding(defaults);
    return;
  }
  let current = {};
  try {
    current = JSON.parse(row.payload);
  } catch (error) {
    current = {};
  }
  const merged = {
    ...defaults,
    ...current,
    contact: { ...defaults.contact, ...(current.contact || {}) },
    heroCta: { ...defaults.heroCta, ...(current.heroCta || {}) }
  };
  const needsUpdate = Object.keys(defaults).some((key) => current[key] === undefined)
    || Object.keys(defaults.contact).some((key) => !current.contact || current.contact[key] === undefined)
    || Object.keys(defaults.heroCta).some((key) => !current.heroCta || current.heroCta[key] === undefined);
  if (needsUpdate) {
    saveBranding(merged);
  }
}

function seedPosts() {
  const total = db.prepare('SELECT COUNT(*) as total FROM posts').get().total;
  if (total > 0) return;
  const city = getCityBySlug(DEFAULT_CITY_SLUG) || db.prepare('SELECT * FROM cities LIMIT 1').get();
  if (!city) return;
  const districts = db.prepare('SELECT * FROM districts WHERE city_id = ?').all(city.id);
  const getDistrictId = (name) => {
    const found = districts.find(d => d.name === name);
    return found ? found.id : null;
  };
  const data = [
    { uid: 'P-3101', rua: 'Rua das Flores', bairro: 'Centro', lat: -23.55052, lng: -46.633308 },
    { uid: 'P-3102', rua: 'Av. Central', bairro: 'Centro', lat: -23.5511, lng: -46.6345 },
    { uid: 'P-3110', rua: 'Rua Nova Esperanca', bairro: 'Bairro Alto', lat: -23.5525, lng: -46.6315 },
    { uid: 'P-3112', rua: 'Rua do Comercio', bairro: 'Zona Norte', lat: -23.5489, lng: -46.6302 },
    { uid: 'P-3120', rua: 'Av. Horizonte', bairro: 'Zona Sul', lat: -23.5541, lng: -46.636 }
  ];
  const stmt = db.prepare('INSERT INTO posts (post_uid, city_id, district_id, rua, bairro, lat, lng, created_at, updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)');
  data.forEach(item => {
    const districtId = getDistrictId(item.bairro);
    stmt.run(item.uid, city.id, districtId, item.rua, item.bairro, item.lat, item.lng);
  });
}
function normalizeStatuses() {
  db.prepare("UPDATE reports SET status = 'em_andamento' WHERE status = 'em andamento'").run();
  db.prepare("UPDATE reports SET status = 'aberto' WHERE status IS NULL OR status = ''").run();
}

function getCityBySlug(slug) {
  if (!slug) return null;
  return db.prepare('SELECT * FROM cities WHERE slug = ?').get(slug);
}

function getCityById(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM cities WHERE id = ?').get(id);
}

function getDefaultCity() {
  return getCityBySlug(DEFAULT_CITY_SLUG) || db.prepare('SELECT * FROM cities WHERE active = 1 LIMIT 1').get();
}

function getBranding() {
  const row = db.prepare('SELECT payload FROM institutional_settings WHERE id = 1').get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (err) {
    return null;
  }
}

function saveBranding(payload) {
  const now = new Date().toISOString();
  const data = JSON.stringify(payload || {});
  db.prepare('INSERT INTO institutional_settings (id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    .run(data, now);
}

function sanitizeText(value, max = 500) {
  if (!value) return '';
  return String(value).substring(0, max).trim();
}

function generateProtocol(citySlug) {
  const now = new Date();
  const prefix = (citySlug || 'PROTO').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  return `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${uuidv4().split('-')[0].toUpperCase()}`;
}

function appendHistory(reportId, status, note, author) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO report_history (report_id, status, note, author, created_at) VALUES (?,?,?,?,?)')
    .run(reportId, status, note || null, author || 'sistema', now);
  const current = db.prepare('SELECT history FROM reports WHERE id = ?').get(reportId);
  let list = [];
  if (current && current.history) {
    try {
      list = JSON.parse(current.history);
    } catch (err) {
      list = [];
    }
  }
  list.push({ status, note: note || null, by: author || 'sistema', at: now });
  db.prepare('UPDATE reports SET history = ? WHERE id = ?').run(JSON.stringify(list), reportId);
}

function getActiveService(slug) {
  if (slug) {
    const service = db.prepare('SELECT * FROM services WHERE slug = ?').get(slug);
    if (service) return service;
  }
  return db.prepare("SELECT * FROM services WHERE status = 'active' ORDER BY order_index LIMIT 1").get();
}

function getCityFromQuery(query) {
  if (!query) return getDefaultCity();
  const city = getCityBySlug(query);
  return city || getDefaultCity();
}

function getScopedCity(req) {
  if (req.user?.role === 'admin') {
    return getCityById(req.user.city_id);
  }
  return getCityFromQuery(req.query.city);
}

function computeResolutionMinutes(createdAt) {
  if (!createdAt) return null;
  const start = new Date(createdAt).getTime();
  const diff = Date.now() - start;
  return Math.max(1, Math.round(diff / 60000));
}

function ensureDistrict(cityId, bairro) {
  if (!cityId || !bairro) return null;
  const trimmed = bairro.trim();
  if (!trimmed) return null;
  let record = db.prepare('SELECT * FROM districts WHERE city_id = ? AND name = ?').get(cityId, trimmed);
  if (!record) {
    db.prepare('INSERT INTO districts (city_id, name) VALUES (?,?)').run(cityId, trimmed);
    record = db.prepare('SELECT * FROM districts WHERE city_id = ? AND name = ?').get(cityId, trimmed);
  }
  return record.id;
}

function ensureStreet(districtId, rua) {
  if (!districtId || !rua) return null;
  const trimmed = rua.trim();
  if (!trimmed) return null;
  let record = db.prepare('SELECT * FROM streets WHERE district_id = ? AND name = ?').get(districtId, trimmed);
  if (!record) {
    db.prepare('INSERT INTO streets (district_id, name) VALUES (?,?)').run(districtId, trimmed);
    record = db.prepare('SELECT * FROM streets WHERE district_id = ? AND name = ?').get(districtId, trimmed);
  }
  return record.id;
}

function buildPublicStatistics(cityId) {
  const statsCity = cityId || getDefaultCity()?.id;
  const total = db.prepare('SELECT COUNT(*) as total FROM reports WHERE city_id = ?').get(statsCity).total;
  const statusRows = db.prepare('SELECT status, COUNT(*) as total FROM reports WHERE city_id = ? GROUP BY status').all(statsCity);
  const status = { aberto: 0, em_andamento: 0, resolvido: 0 };
  statusRows.forEach(row => {
    if (status[row.status] !== undefined) status[row.status] = row.total;
  });
  const averageResolution = db.prepare('SELECT AVG(resolution_minutes) as avg FROM reports WHERE city_id = ? AND resolution_minutes IS NOT NULL').get(statsCity).avg;
  const recent = db.prepare('SELECT protocol, status, created_at FROM reports WHERE city_id = ? ORDER BY created_at DESC LIMIT 5').all(statsCity);
  const bairros = db.prepare('SELECT bairro, COUNT(*) as total FROM reports WHERE city_id = ? AND bairro IS NOT NULL GROUP BY bairro ORDER BY total DESC LIMIT 5').all(statsCity);
  const services = db.prepare(`SELECT s.name, s.slug, s.status, s.description,
      COUNT(r.id) as total_reports
    FROM services s
    LEFT JOIN reports r ON r.service_id = s.id AND r.city_id = ?
    GROUP BY s.id
    ORDER BY s.order_index`).all(statsCity);
  return {
    totalReports: total,
    status,
    averageResolutionMinutes: averageResolution ? Number(averageResolution).toFixed(1) : null,
    recentProtocols: recent,
    hotspots: bairros,
    services,
    generatedAt: new Date().toISOString()
  };
}
function getFilters(cityId) {
  const bairros = db.prepare('SELECT DISTINCT bairro FROM posts WHERE city_id = ? AND bairro IS NOT NULL ORDER BY bairro').all(cityId).map(row => row.bairro);
  const ruas = db.prepare('SELECT DISTINCT rua FROM posts WHERE city_id = ? AND rua IS NOT NULL ORDER BY rua').all(cityId).map(row => row.rua);
  const services = db.prepare('SELECT id, name, slug, status FROM services ORDER BY order_index').all();
  return { bairros, ruas, services, statuses: ALLOWED_STATUSES };
}

function normalizeStatus(value) {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  return ALLOWED_STATUSES.includes(normalized) ? normalized : null;
}

function getReports(cityId, query = {}) {
  let sql = `SELECT r.*, p.post_uid, p.lat AS post_lat, p.lng AS post_lng FROM reports r
    JOIN posts p ON r.post_id = p.id
    WHERE r.city_id = ?`;
  const params = [cityId];
  if (query.bairro) {
    sql += ' AND r.bairro = ?';
    params.push(query.bairro);
  }
  if (query.rua) {
    sql += ' AND r.rua = ?';
    params.push(query.rua);
  }
  if (query.status) {
    const normalized = normalizeStatus(query.status);
    if (normalized) {
      sql += ' AND r.status = ?';
      params.push(normalized);
    }
  }
  if (query.service_slug) {
    sql += ' AND r.service_id = (SELECT id FROM services WHERE slug = ? LIMIT 1)';
    params.push(query.service_slug);
  }
  if (query.start) {
    sql += ' AND r.created_at >= ?';
    params.push(query.start);
  }
  if (query.end) {
    sql += ' AND r.created_at <= ?';
    params.push(query.end);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT 500';
  return db.prepare(sql).all(...params);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token ausente' });
  const [, token] = header.split(' ');
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nao autenticado' });
    if (req.user.role === 'dev') return next();
    if (req.user.role === role) return next();
    return res.status(403).json({ error: 'Permissao negada' });
  };
}
app.get('/api/public/config', (req, res) => {
  const cities = db.prepare('SELECT id, name, slug, default_lat, default_lng, default_zoom FROM cities WHERE active = 1 ORDER BY name').all();
  const branding = getBranding();
  const services = db.prepare('SELECT name, slug, status, description FROM services ORDER BY order_index').all();
  res.json({
    cities,
    defaultCity: getCityBySlug(DEFAULT_CITY_SLUG) || cities[0] || null,
    services,
    branding
  });
});

app.get('/api/public/posts', (req, res) => {
  const city = getCityFromQuery(req.query.city);
  const posts = db.prepare('SELECT id, post_uid, rua, bairro, lat, lng FROM posts WHERE city_id = ? AND ativo = 1 ORDER BY post_uid').all(city.id);
  res.json({ city, posts });
});

app.get('/api/public/statistics', (req, res) => {
  const city = getCityFromQuery(req.query.city);
  res.json({ city, ...buildPublicStatistics(city.id) });
});

app.get('/api/public/services', (req, res) => {
  const services = db.prepare('SELECT name, slug, status, description FROM services ORDER BY order_index').all();
  res.json(services);
});

app.post('/api/report', reportLimiter, upload.single('image'), (req, res) => {
  try {
    const { post_id, type, description, service_slug, browser_lat, browser_lng } = req.body;
    if (!post_id || !type) {
      return res.status(400).json({ error: 'Poste e tipo sao obrigatorios' });
    }
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(post_id);
    if (!post) return res.status(404).json({ error: 'Poste nao encontrado' });
    const service = getActiveService(service_slug);
    if (!service) return res.status(400).json({ error: 'Nenhum servico ativo disponivel' });

    const lat = browser_lat ? Number(browser_lat) : null;
    const lng = browser_lng ? Number(browser_lng) : null;
    const cityInfo = getCityById(post.city_id);
    const protocol = generateProtocol(cityInfo?.slug || DEFAULT_CITY_SLUG);
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const now = new Date().toISOString();

    let imagePath = null;
    if (req.file) {
      imagePath = `/uploads/${req.file.filename}`;
    }

    const insert = db.prepare(`INSERT INTO reports (protocol, service_id, post_id, city_id, district_id, bairro, rua, type, description, image, ip, browser_lat, browser_lng, status, created_at, updated_at, history, origin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const info = insert.run(
      protocol,
      service.id,
      post.id,
      post.city_id,
      post.district_id,
      post.bairro,
      post.rua,
      sanitizeText(type, 120),
      sanitizeText(description, 1000),
      imagePath,
      ip,
      lat,
      lng,
      'aberto',
      now,
      now,
      JSON.stringify([]),
      'portal'
    );

    appendHistory(info.lastInsertRowid, 'aberto', 'Chamado aberto via portal', 'cidadao');

    res.json({ protocol, status: STATUS_LABELS['aberto'] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar denuncia' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario e senha sao obrigatorios' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciais invalidas' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais invalidas' });
  const city = user.city_id ? getCityById(user.city_id) : null;
  if (user.role === 'admin' && !city) {
    return res.status(403).json({ error: 'Admin sem cidade vinculada. Solicite ao Dev a configuracao.' });
  }
  const payload = { id: user.id, username: user.username, role: user.role, city_id: user.city_id || null };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
  let cityPayload = null;
  if (city) {
    cityPayload = {
      id: city.id,
      name: city.name,
      slug: city.slug,
      default_lat: city.default_lat,
      default_lng: city.default_lng,
      default_zoom: city.default_zoom
    };
  }
  res.json({ token, role: user.role, city: cityPayload });
});
app.get('/api/admin/meta', authMiddleware, requireRole('admin'), (req, res) => {
  const city = getScopedCity(req);
  if (!city) return res.status(400).json({ error: 'Cidade nao configurada para este usuario' });
  res.json({ city, ...getFilters(city.id) });
});

app.get('/api/admin/dashboard', authMiddleware, requireRole('admin'), (req, res) => {
  const city = getScopedCity(req);
  if (!city) return res.status(400).json({ error: 'Cidade nao configurada para este usuario' });
  const stats = buildPublicStatistics(city.id);
  const monthly = db.prepare(`SELECT strftime('%Y-%m', created_at) as label, COUNT(*) as total
    FROM reports
    WHERE city_id = ? AND created_at >= date('now','-5 months')
    GROUP BY label
    ORDER BY label`).all(city.id);
  const serviceBreakdown = db.prepare(`SELECT s.name, s.slug, COUNT(r.id) as total
    FROM services s
    LEFT JOIN reports r ON r.service_id = s.id AND r.city_id = ?
    GROUP BY s.id
    ORDER BY s.order_index`).all(city.id);
  res.json({ city, stats, monthly, serviceBreakdown });
});

app.get('/api/admin/reports', authMiddleware, requireRole('admin'), (req, res) => {
  const city = getScopedCity(req);
  if (!city) return res.status(400).json({ error: 'Cidade nao configurada para este usuario' });
  const reports = getReports(city.id, req.query);
  res.json(reports);
});

app.get('/api/admin/reports/:id/history', authMiddleware, requireRole('admin'), (req, res) => {
  const city = getScopedCity(req);
  if (!city) return res.status(400).json({ error: 'Cidade nao configurada para este usuario' });
  const report = db.prepare('SELECT city_id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Chamado nao encontrado' });
  if (req.user.role === 'admin' && report.city_id !== city.id) {
    return res.status(403).json({ error: 'Sem permissao para este chamado' });
  }
  const history = db.prepare('SELECT status, note, author, created_at FROM report_history WHERE report_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(history);
});

app.patch('/api/admin/reports/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const { status, note } = req.body;
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!report) return res.status(404).json({ error: 'Chamado nao encontrado' });
  const city = getScopedCity(req);
  if (!city) return res.status(400).json({ error: 'Cidade nao configurada para este usuario' });
  if (req.user.role === 'admin' && report.city_id !== city.id) {
    return res.status(403).json({ error: 'Sem permissao para alterar este chamado' });
  }

  const updates = [];
  const params = [];
  const now = new Date().toISOString();
  let newStatus = report.status;
  if (status) {
    const normalized = normalizeStatus(status);
    if (!normalized) {
      return res.status(400).json({ error: 'Status invalido' });
    }
    if (normalized !== report.status) {
      newStatus = normalized;
      updates.push('status = ?');
      params.push(newStatus);
      if (newStatus === 'resolvido') {
        const minutes = computeResolutionMinutes(report.created_at);
        updates.push('resolved_at = ?');
        params.push(now);
        updates.push('resolution_minutes = ?');
        params.push(minutes);
      } else {
        updates.push('resolved_at = NULL');
        updates.push('resolution_minutes = NULL');
      }
    }
  }
  updates.push('updated_at = ?');
  params.push(now);

  if (updates.length) {
    params.push(id);
    db.prepare(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  if (status || note) {
    appendHistory(id, newStatus, sanitizeText(note, 800), req.user.username);
  }
  res.json({ ok: true });
});

app.get('/api/admin/export', authMiddleware, requireRole('admin'), (req, res) => {
  const city = getScopedCity(req);
  if (!city) return res.status(400).json({ error: 'Cidade nao configurada para este usuario' });
  const reports = getReports(city.id, req.query);
  const header = ['protocol', 'status', 'created_at', 'type', 'post_uid', 'rua', 'bairro', 'service_slug'];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-chamados.csv"');
  res.write(header.join(',') + '\n');
  const serviceSlugStmt = db.prepare('SELECT slug FROM services WHERE id = ?');
  reports.forEach(row => {
    const slug = serviceSlugStmt.get(row.service_id)?.slug || '';
    const line = [row.protocol, row.status, row.created_at, row.type, row.post_uid, row.rua, row.bairro, slug]
      .map(value => '"' + (value || '') + '"').join(',');
    res.write(line + '\n');
  });
  res.end();
});
app.get('/api/dev/posts', authMiddleware, requireRole('dev'), (req, res) => {
  const city = req.query.city === 'all' ? null : getCityFromQuery(req.query.city);
  let sql = `SELECT p.*, c.name as city_name FROM posts p JOIN cities c ON p.city_id = c.id`;
  const params = [];
  if (city) {
    sql += ' WHERE p.city_id = ?';
    params.push(city.id);
  }
  sql += ' ORDER BY p.updated_at DESC LIMIT 300';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.post('/api/dev/posts', authMiddleware, requireRole('dev'), (req, res) => {
  const { city_slug, post_uid, rua, bairro, lat, lng } = req.body;
  if (!city_slug || !post_uid || !rua || !bairro || !lat || !lng) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes' });
  }
  const city = getCityBySlug(city_slug);
  if (!city) return res.status(400).json({ error: 'Cidade invalida' });
  const districtId = ensureDistrict(city.id, bairro);
  const streetId = ensureStreet(districtId, rua);
  db.prepare(`INSERT INTO posts (post_uid, city_id, district_id, street_id, rua, bairro, lat, lng, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`) 
    .run(post_uid.trim(), city.id, districtId, streetId, rua.trim(), bairro.trim(), Number(lat), Number(lng));
  res.json({ ok: true });
});

app.put('/api/dev/posts/:id', authMiddleware, requireRole('dev'), (req, res) => {
  const { rua, bairro, lat, lng } = req.body;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Poste nao encontrado' });
  const districtId = bairro ? ensureDistrict(post.city_id, bairro) : post.district_id;
  const streetId = rua ? ensureStreet(districtId, rua) : post.street_id;
  db.prepare('UPDATE posts SET rua = ?, bairro = ?, lat = ?, lng = ?, district_id = ?, street_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(rua || post.rua, bairro || post.bairro, lat ? Number(lat) : post.lat, lng ? Number(lng) : post.lng, districtId, streetId, post.id);
  res.json({ ok: true });
});

app.delete('/api/dev/posts/:id', authMiddleware, requireRole('dev'), (req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/dev/cities', authMiddleware, requireRole('dev'), (req, res) => {
  const cities = db.prepare('SELECT * FROM cities ORDER BY name').all();
  res.json(cities);
});

app.post('/api/dev/cities', authMiddleware, requireRole('dev'), (req, res) => {
  const { name, slug, default_lat, default_lng, default_zoom } = req.body;
  if (!name || !slug || !default_lat || !default_lng) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes' });
  }
  db.prepare('INSERT INTO cities (name, slug, default_lat, default_lng, default_zoom, active) VALUES (?,?,?,?,?,1)')
    .run(name.trim(), slug.trim().toLowerCase(), Number(default_lat), Number(default_lng), Number(default_zoom) || 13);
  res.json({ ok: true });
});

app.patch('/api/dev/cities/:id', authMiddleware, requireRole('dev'), (req, res) => {
  const city = db.prepare('SELECT * FROM cities WHERE id = ?').get(req.params.id);
  if (!city) return res.status(404).json({ error: 'Cidade nao encontrada' });
  const fields = [];
  const params = [];
  ['name', 'slug', 'default_lat', 'default_lng', 'default_zoom', 'active'].forEach(key => {
    if (req.body[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key.includes('lat') || key.includes('lng') || key.includes('zoom') || key === 'active' ? Number(req.body[key]) : req.body[key]);
    }
  });
  if (!fields.length) return res.json({ ok: true });
  params.push(city.id);
  db.prepare(`UPDATE cities SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

app.get('/api/dev/services', authMiddleware, requireRole('dev'), (req, res) => {
  const services = db.prepare('SELECT * FROM services ORDER BY order_index').all();
  res.json(services);
});

app.post('/api/dev/services', authMiddleware, requireRole('dev'), (req, res) => {
  const { name, slug, description, status, order_index } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'Nome e slug sao obrigatorios' });
  }
  db.prepare('INSERT INTO services (name, slug, description, status, order_index) VALUES (?,?,?,?,?)')
    .run(name.trim(), slug.trim().toLowerCase(), description || '', status || 'upcoming', Number(order_index) || 0);
  res.json({ ok: true });
});

app.patch('/api/dev/services/:id', authMiddleware, requireRole('dev'), (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Servico nao encontrado' });
  const fields = [];
  const params = [];
  ['name', 'status', 'description', 'order_index'].forEach(key => {
    if (req.body[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === 'order_index' ? Number(req.body[key]) : req.body[key]);
    }
  });
  if (!fields.length) return res.json({ ok: true });
  params.push(service.id);
  db.prepare(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

app.get('/api/dev/branding', authMiddleware, requireRole('dev'), (req, res) => {
  res.json(getBranding());
});

app.patch('/api/dev/branding', authMiddleware, requireRole('dev'), (req, res) => {
  const branding = getBranding() || {};
  const next = { ...branding, ...req.body };
  saveBranding(next);
  res.json({ ok: true });
});

app.get('/api/dev/users', authMiddleware, requireRole('dev'), (req, res) => {
  const users = db.prepare(`SELECT u.id, u.username, u.role, u.created_at, u.city_id,
      c.name as city_name, c.slug as city_slug
    FROM users u
    LEFT JOIN cities c ON u.city_id = c.id
    ORDER BY u.username`).all();
  res.json(users);
});

app.post('/api/dev/users', authMiddleware, requireRole('dev'), async (req, res) => {
  const { username, password, role, city_slug } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Campos obrigatorios ausentes' });
  }
  let cityId = null;
  if (role === 'admin') {
    if (!city_slug) {
      return res.status(400).json({ error: 'Admin precisa estar vinculado a uma cidade' });
    }
    const city = getCityBySlug(city_slug);
    if (!city) {
      return res.status(400).json({ error: 'Cidade informada nao encontrada' });
    }
    cityId = city.id;
  } else if (city_slug) {
    const city = getCityBySlug(city_slug);
    cityId = city?.id || null;
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password_hash, role, city_id) VALUES (?,?,?,?)')
    .run(username.trim(), hash, role, cityId);
  res.json({ ok: true });
});

app.patch('/api/dev/users/:id', authMiddleware, requireRole('dev'), async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
  const fields = [];
  const params = [];
  const targetRole = req.body.role || user.role;
  let targetCityId = user.city_id;
  if (req.body.city_slug !== undefined) {
    if (req.body.city_slug) {
      const city = getCityBySlug(req.body.city_slug);
      if (!city) return res.status(400).json({ error: 'Cidade informada nao encontrada' });
      targetCityId = city.id;
    } else {
      targetCityId = null;
    }
  }
  if (targetRole === 'admin' && !targetCityId) {
    return res.status(400).json({ error: 'Admin precisa ter cidade vinculada' });
  }
  if (req.body.role) {
    fields.push('role = ?');
    params.push(req.body.role);
  }
  if (req.body.city_slug !== undefined) {
    fields.push('city_id = ?');
    params.push(targetCityId);
  }
  if (req.body.password) {
    const hash = bcrypt.hashSync(req.body.password, 10);
    fields.push('password_hash = ?');
    params.push(hash);
  }
  if (!fields.length) return res.json({ ok: true });
  params.push(user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});
const clientRoutes = [
  { path: '/', file: 'index.html' },
  { path: '/contato', file: 'contato.html' },
  { path: '/painel', file: 'painel.html' }
];

clientRoutes.forEach(route => {
  app.get(route.path, (_, res) => {
    res.sendFile(path.join(PUBLIC_DIR, route.file));
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || (err && err.message && err.message.includes('Apenas imagens'))) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

async function startServer() {
  try {
    SQL = await initSqlJs({
      locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
    });
    memoryDb = loadDatabase();
    initDb();
    persistDb();
    app.listen(PORT, () => {
      console.log(`Servidor institucional iniciado na porta ${PORT}`);
    });
  } catch (error) {
    console.error('Falha ao inicializar o banco de dados', error);
    process.exit(1);
  }
}

startServer();
