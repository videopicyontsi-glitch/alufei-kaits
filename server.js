const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({limit:'25mb'}));
app.use(express.static(__dirname, {etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')}));
app.use('/ogden', express.static(path.join(__dirname, 'public/ogden'), {setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400')}));

/* =====================================================================
   פנקס מפק"ץ — Role-based system (SQLite + sessions)
   ===================================================================== */
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

const db = new Database(path.join(__dirname, 'pinkus.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  staff TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL,
  mefakatz_id INTEGER REFERENCES users(id),
  team_id INTEGER REFERENCES teams(id),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cadet_details (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  age INTEGER, marital_status TEXT, city TEXT, address TEXT,
  phone TEXT, spouse_phone TEXT, parents_phone TEXT,
  num_children INTEGER, civilian_profession TEXT, shirt_size TEXT,
  notes TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS cadet_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cadet_id INTEGER REFERENCES users(id),
  mefakatz_id INTEGER REFERENCES users(id),
  data TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mefakatz_id INTEGER REFERENCES users(id),
  name TEXT, date TEXT, published INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS exam_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER REFERENCES exams(id),
  cadet_id INTEGER REFERENCES users(id),
  grade REAL, notes TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES users(id),
  scope TEXT, target_id INTEGER, mefakatz_scope_id INTEGER,
  type TEXT, title TEXT, content TEXT, link_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS survey_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER REFERENCES announcements(id),
  option_text TEXT, display_order INTEGER
);
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER REFERENCES announcements(id),
  option_id INTEGER REFERENCES survey_options(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(announcement_id, user_id)
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mefakatz_id INTEGER REFERENCES users(id),
  title TEXT, content TEXT, type TEXT, stage INTEGER DEFAULT 1,
  published INTEGER DEFAULT 0, due_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER REFERENCES materials(id),
  cadet_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'pending', submission_text TEXT, submitted_at TEXT,
  UNIQUE(material_id, cadet_id)
);
CREATE TABLE IF NOT EXISTS cadet_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cadet_id INTEGER REFERENCES users(id),
  mefakatz_id INTEGER REFERENCES users(id),
  score INTEGER,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(cadet_id)
);
CREATE TABLE IF NOT EXISTS commander_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cadet_id INTEGER REFERENCES users(id) UNIQUE,
  score INTEGER,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

// Migrations
try { db.prepare("ALTER TABLE teams ADD COLUMN staff TEXT DEFAULT '[]'").run(); } catch(e) {}
try { db.prepare("ALTER TABLE announcements ADD COLUMN image_url TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE announcements ADD COLUMN team_scope_id INTEGER").run(); } catch(e) {}
try { db.prepare("ALTER TABLE announcements ADD COLUMN is_popup INTEGER DEFAULT 0").run(); } catch(e) {}
// Migrate ogden URLs from Cloudinary to local static paths
try {
  db.prepare("UPDATE ogden_chapters SET url = '/ogden/' || start_page || '.pdf' WHERE url LIKE '%cloudinary%'").run();
} catch(e) {}
// Remove quotes from team names
try { db.prepare("UPDATE teams SET name='חלג' WHERE name='חל\"ג'").run(); } catch(e) {}
try { db.prepare("UPDATE teams SET name='אלמר' WHERE name='אלמ\"ר'").run(); } catch(e) {}
try { db.prepare("UPDATE users SET full_name='מפקד חלג' WHERE full_name='מפקד חל\"ג'").run(); } catch(e) {}
try { db.prepare("UPDATE users SET full_name='מפקד אלמר' WHERE full_name='מפקד אלמ\"ר'").run(); } catch(e) {}

// Ogden chapters table
db.exec(`
CREATE TABLE IF NOT EXISTS ogden_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_page INTEGER,
  end_page INTEGER,
  week INTEGER DEFAULT 1,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ogden_visibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mefakatz_id INTEGER REFERENCES users(id),
  chapter_id INTEGER REFERENCES ogden_chapters(id),
  visible INTEGER DEFAULT 0,
  UNIQUE(mefakatz_id, chapter_id)
);
`);

// Seed ogden chapters if not yet present
if (!db.prepare("SELECT 1 FROM ogden_chapters LIMIT 1").get()) {
  const chapters = [
    ["מבנה וארגון צה\"ל",      2,  21,  1, "/ogden/2.pdf"],
    ["רוח צה\"ל",               22, 41,  1, "/ogden/22.pdf"],
    ["המקצוע הצבאי",            42, 61,  1, "/ogden/42.pdf"],
    ["אחריות וסמכות",           62, 75,  1, "/ogden/62.pdf"],
    ["מערכת הצווים בצה\"ל",     76, 89,  2, "/ogden/76.pdf"],
    ["דילמות ערכיות בקצונה",    90, 103, 2, "/ogden/90.pdf"],
    ["פיקוד ממלכתי",            104,117, 2, "/ogden/104.pdf"],
    ["המעשה המוסדי",            118,131, 2, "/ogden/118.pdf"],
    ["מוסד המפקד",              132,145, 3, "/ogden/132.pdf"],
    ["מידענות צבאית",           146,159, 3, "/ogden/146.pdf"],
    ["עקרונות המלחמה",          160,173, 3, "/ogden/160.pdf"],
    ["תופעות המלחמה",           174,187, 3, "/ogden/174.pdf"],
    ["עקרונות הפו\"ש",          188,201, 4, "/ogden/188.pdf"],
    ["הגנה",                    202,215, 4, "/ogden/202.pdf"],
    ["התקפה",                   216,229, 4, "/ogden/216.pdf"],
    ["נוה\"ק",                  230,243, 4, "/ogden/230.pdf"],
    ["מעגל מבצעי",              244,254, 5, "/ogden/244.pdf"],
    ["בטיחות במטווחים",         255,265, 5, "/ogden/255.pdf"],
    ["נקח\"ל",                  266,272, 5, "/ogden/266.pdf"],
    ["כתיבה צבאית",             273,277, 5, "/ogden/273.pdf"],
    ["פקמ\"ב",                  278,280, 5, "/ogden/278.pdf"],
  ];
  const ins = db.prepare("INSERT INTO ogden_chapters (name,start_page,end_page,week,url,sort_order) VALUES (?,?,?,?,?,?)");
  chapters.forEach(([name,s,e,w,url],i) => ins.run(name,s,e,w,url,i+1));
  console.log("Seeded 21 ogden chapters");
}

// Seed teams
const DEFAULT_TEAMS = ["חלג","אלמר","הובלה","רפואה","טנא"];
DEFAULT_TEAMS.forEach(t => {
  try { db.prepare("INSERT INTO teams (name) VALUES (?)").run(t); } catch(e) {}
});

// Seed / ensure commander accounts always exist
const cmdAccounts = [
  { username: 'mefaked', password: 'שלמה',  full_name: 'מפקד הקורס' },
  { username: 'madriha', password: 'מדרית', full_name: 'מדריכת הקורס' },
];
for (const a of cmdAccounts) {
  const exists = db.prepare("SELECT id FROM users WHERE username=?").get(a.username);
  if (exists) {
    db.prepare("UPDATE users SET password_hash=? WHERE username=?")
      .run(bcrypt.hashSync(a.password, 10), a.username);
  } else {
    db.prepare("INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)")
      .run(a.username, bcrypt.hashSync(a.password, 10), a.full_name, 'commander');
    console.log(`Seeded commander: ${a.username}`);
  }
}

// Always upsert mefakatzim with canonical usernames/names
{
  const teams = db.prepare("SELECT id,name FROM teams").all();
  const teamId = name => (teams.find(t=>t.name===name)||teams[0])?.id;
  const MEF_ACCOUNTS = [
    {u:'mefaked_halg',  n:"מפקד חלג",  team:"חלג"},
    {u:'mefaked_almar', n:"מפקד אלמר", team:"אלמר"},
    {u:'mefaked_hovla', n:'מפקד הובלה',  team:'הובלה'},
    {u:'mefaked_refua', n:'מפקד רפואה',  team:'רפואה'},
    {u:'mefaked_tana',  n:'מפקד טנא',    team:'טנא'},
  ];
  const OLD_USERNAMES = ['cohen_s','levi_y','mizrahi_d','peretz_a','shapira_r'];
  // Remove old seed usernames if they still exist (first deploy migration)
  OLD_USERNAMES.forEach(ou => {
    const old = db.prepare("SELECT id FROM users WHERE username=?").get(ou);
    if (old) db.prepare("UPDATE users SET username=?, full_name=? WHERE id=?")
      .run(MEF_ACCOUNTS[OLD_USERNAMES.indexOf(ou)].u, MEF_ACCOUNTS[OLD_USERNAMES.indexOf(ou)].n, old.id);
  });
  MEF_ACCOUNTS.forEach(m => {
    const existing = db.prepare("SELECT id FROM users WHERE username=?").get(m.u);
    if (existing) {
      db.prepare("UPDATE users SET full_name=?, team_id=? WHERE id=?")
        .run(m.n, teamId(m.team), existing.id);
    } else {
      db.prepare("INSERT OR IGNORE INTO users (username,password_hash,full_name,role,team_id) VALUES (?,?,?,?,?)")
        .run(m.u, bcrypt.hashSync('1234', 10), m.n, 'mefakatz', teamId(m.team));
    }
  });
}

// Seed mefakatzim + cadets
if (!db.prepare("SELECT 1 FROM users WHERE role='mefakatz' LIMIT 1").get()) {
  const teams = db.prepare("SELECT id,name FROM teams").all();
  const teamId = name => (teams.find(t=>t.name===name)||teams[0]).id;
  const MEFS = [
    {u:'mefaked_halg',  n:"מפקד חלג",  team:"חלג"},
    {u:'mefaked_almar', n:"מפקד אלמר", team:"אלמר"},
    {u:'mefaked_hovla', n:'מפקד הובלה',  team:'הובלה'},
    {u:'mefaked_refua', n:'מפקד רפואה',  team:'רפואה'},
    {u:'mefaked_tana',  n:'מפקד טנא',    team:'טנא'},
  ];
  const CADETS = [
    ['katz_u','אורי כץ',0],['bendavid_n','נועם בן-דוד',0],['haim_a','עמית חיים',0],['golan_y','יואב גולן',0],
    ['barak_t','תומר ברק',1],['segal_r','רועי סגל',1],['avraham_m','מיכאל אברהם',1],['shlomo_n','ניר שלמה',1],
    ['friedman_g','גיל פרידמן',2],['israel_a','אלון ישראל',2],['tal_l','ליאור טל',2],['stern_s','שי שטרן',2],
    ['menachem_e','איתן מנחם',3],['uziel_n','נתן עוזיאל',3],['kadosh_y','ירון קדוש',3],['bitan_a','אסף ביטון',3],
    ['nissim_o','עמרי ניסים',4],['gross_b','בן גרוס',4],['amselam_y','יואב אמסלם',4],['rivkin_e','אלעד ריבקין',4],
  ];
  const mefIds = MEFS.map(m => {
    const info = db.prepare("INSERT OR IGNORE INTO users (username,password_hash,full_name,role,team_id) VALUES (?,?,?,?,?)")
      .run(m.u, bcrypt.hashSync('1234', 10), m.n, 'mefakatz', teamId(m.team));
    return info.lastInsertRowid || db.prepare("SELECT id FROM users WHERE username=?").get(m.u).id;
  });
  CADETS.forEach(([u,n,mi]) => {
    const info = db.prepare("INSERT OR IGNORE INTO users (username,password_hash,full_name,role,mefakatz_id) VALUES (?,?,?,?,?)")
      .run(u, bcrypt.hashSync('1234', 10), n, 'tzaer', mefIds[mi]);
    const uid = info.lastInsertRowid || db.prepare("SELECT id FROM users WHERE username=?").get(u).id;
    db.prepare("INSERT OR IGNORE INTO cadet_details (user_id,updated_at) VALUES (?,datetime('now'))").run(uid);
  });
  console.log("Seeded 5 mefakatzim + 20 cadets (password: 1234)");
}

app.use(session({
  store: new SQLiteStore({ db: 'pinkus-sessions.db', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'pinkus_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

function requirePinkusAuth(roles) {
  return (req, res, next) => {
    const u = req.session.pinkusUser;
    if (!u) return res.status(401).json({ error: 'not_authenticated' });
    if (roles && roles.length && !roles.includes(u.role))
      return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/* ---------- Auth ---------- */
app.post('/api/pinkus/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!u || !u.active || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'invalid_credentials' });
  req.session.pinkusUser = { id: u.id, username: u.username, full_name: u.full_name, role: u.role, mefakatz_id: u.mefakatz_id };
  res.json(req.session.pinkusUser);
});

app.post('/api/pinkus/logout', (req, res) => {
  req.session.pinkusUser = null;
  res.json({ ok: true });
});

app.get('/api/pinkus/me', (req, res) => {
  if (!req.session.pinkusUser) return res.status(401).json({ error: 'not_authenticated' });
  res.json(req.session.pinkusUser);
});

// Open registration (mefakatz / tzaer)
app.post('/api/pinkus/register', (req, res) => {
  const { full_name, username, password, role, mefakatz_id } = req.body || {};
  if (!username || !password || !['mefakatz', 'tzaer'].includes(role))
    return res.status(400).json({ error: 'bad_request' });
  if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username))
    return res.status(409).json({ error: 'username_taken' });
  const mid = role === 'tzaer' ? (mefakatz_id || null) : null;
  const info = db.prepare("INSERT INTO users (username,password_hash,full_name,role,mefakatz_id) VALUES (?,?,?,?,?)")
    .run(username, bcrypt.hashSync(password, 10), full_name || username, role, mid);
  if (role === 'tzaer') db.prepare("INSERT OR IGNORE INTO cadet_details (user_id,updated_at) VALUES (?,datetime('now'))").run(info.lastInsertRowid);
  req.session.pinkusUser = { id: info.lastInsertRowid, username, full_name: full_name || username, role, mefakatz_id: mid };
  res.json(req.session.pinkusUser);
});

// (mefakatzim route defined below with teams)

/* ---------- Commander ---------- */
app.get('/api/pinkus/users', requirePinkusAuth(['commander']), (req, res) => {
  res.json(db.prepare(`
    SELECT u.id,u.username,u.full_name,u.role,u.active,u.mefakatz_id,u.team_id,
           m.full_name AS mefakatz_name, t.name AS team_name
    FROM users u LEFT JOIN users m ON u.mefakatz_id=m.id LEFT JOIN teams t ON u.team_id=t.id
    ORDER BY u.role, u.full_name`).all());
});

app.post('/api/pinkus/users', requirePinkusAuth(['commander']), (req, res) => {
  const { full_name, role, mefakatz_id, username, password } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'bad_request' });
  if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username))
    return res.status(409).json({ error: 'username_taken' });
  const info = db.prepare("INSERT INTO users (username,password_hash,full_name,role,mefakatz_id) VALUES (?,?,?,?,?)")
    .run(username, bcrypt.hashSync(password, 10), full_name || username, role, role === 'tzaer' ? (mefakatz_id || null) : null);
  if (role === 'tzaer') db.prepare("INSERT OR IGNORE INTO cadet_details (user_id,updated_at) VALUES (?,datetime('now'))").run(info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/pinkus/users/:id', requirePinkusAuth(['commander']), (req, res) => {
  const { full_name, active, mefakatz_id, team_id, role, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE users SET full_name=?,active=?,mefakatz_id=?,team_id=?,role=? WHERE id=?")
    .run(full_name ?? u.full_name, active != null ? (active ? 1 : 0) : u.active,
         mefakatz_id !== undefined ? mefakatz_id : u.mefakatz_id,
         team_id !== undefined ? team_id : u.team_id,
         role || u.role, u.id);
  if (password) db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password, 10), u.id);
  res.json({ ok: true });
});

app.delete('/api/pinkus/users/:id', requirePinkusAuth(['commander']), (req, res) => {
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/pinkus/users/import-excel', requirePinkusAuth(['commander']), (req, res) => {
  const { fileBase64 } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: 'no_file' });
  let rows;
  try {
    const buf = Buffer.from(fileBase64.split(',').pop(), 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  } catch (e) { return res.status(400).json({ error: 'parse_failed' }); }
  const results = [];
  const mefByName = {}, mefByUser = {};
  db.prepare("SELECT id,full_name,username FROM users WHERE role='mefakatz'").all()
    .forEach(m => { mefByName[(m.full_name || '').trim()] = m.id; mefByUser[(m.username || '').trim()] = m.id; });
  const roleMap = { 'מפקץ': 'mefakatz', 'מפק"ץ': 'mefakatz', 'מפק״ץ': 'mefakatz', 'צוער': 'tzaer', 'commander': 'commander', 'mefakatz': 'mefakatz', 'tzaer': 'tzaer' };
  for (const r of rows) {
    const username = String(r.username || '').trim();
    const password = String(r.password || '').trim();
    const role = roleMap[String(r.role || '').trim()] || null;
    const full_name = String(r.full_name || username).trim();
    if (!username || !password || !role) { results.push({ username, created: false, skipped: 'נתונים חסרים' }); continue; }
    if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username)) { results.push({ username, created: false, skipped: 'קיים' }); continue; }
    let mid = null;
    if (role === 'tzaer') {
      const mn = String(r.mefakatz_name || '').trim(), mu = String(r.mefakatz_username || '').trim();
      mid = mefByUser[mu] || mefByName[mn] || null;
    }
    const info = db.prepare("INSERT INTO users (username,password_hash,full_name,role,mefakatz_id) VALUES (?,?,?,?,?)")
      .run(username, bcrypt.hashSync(password, 10), full_name, role, mid);
    if (role === 'mefakatz') { mefByName[full_name] = info.lastInsertRowid; mefByUser[username] = info.lastInsertRowid; }
    if (role === 'tzaer') db.prepare("INSERT OR IGNORE INTO cadet_details (user_id,updated_at) VALUES (?,datetime('now'))").run(info.lastInsertRowid);
    results.push({ username, created: true });
  }
  res.json(results);
});

app.get('/api/pinkus/commander/overview', requirePinkusAuth(['commander']), (req, res) => {
  const mefakatzim = db.prepare(`
    SELECT m.id, m.full_name, t.name AS team_name,
      (SELECT COUNT(*) FROM users c WHERE c.mefakatz_id=m.id AND c.role='tzaer') AS cadet_count
    FROM users m LEFT JOIN teams t ON m.team_id=t.id WHERE m.role='mefakatz' ORDER BY t.name, m.full_name`).all();
  const cadets = db.prepare(`
    SELECT c.id, c.full_name, c.active, c.mefakatz_id, m.full_name AS mefakatz_name, t.name AS team_name,
      cr.score AS mef_score, cg.score AS cmd_score
    FROM users c LEFT JOIN users m ON c.mefakatz_id=m.id LEFT JOIN teams t ON m.team_id=t.id
    LEFT JOIN cadet_ratings cr ON cr.cadet_id=c.id LEFT JOIN commander_grades cg ON cg.cadet_id=c.id
    WHERE c.role='tzaer' ORDER BY t.name, m.full_name, c.full_name`).all();
  res.json({ mefakatzim, cadets });
});

app.post('/api/pinkus/commander/announce', requirePinkusAuth(['commander']), (req, res) => {
  const { scope, target_id, mefakatz_scope_id, team_scope_id, type, title, content, link_url, image_url, is_popup, options } = req.body || {};
  const VALID_SCOPES = ['all_cadets','all_mefakatzim','team_cadets','team_mefakatzim','mefakatz_cadets','personal'];
  const sc = VALID_SCOPES.includes(scope) ? scope : 'all_cadets';
  const info = db.prepare(`INSERT INTO announcements
    (author_id,scope,target_id,mefakatz_scope_id,team_scope_id,type,title,content,link_url,image_url,is_popup)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      req.session.pinkusUser.id, sc,
      sc === 'personal' ? (target_id || null) : null,
      sc === 'mefakatz_cadets' ? (mefakatz_scope_id || null) : null,
      ['team_cadets','team_mefakatzim'].includes(sc) ? (team_scope_id || null) : null,
      type || 'message', title || '', content || '', link_url || null, image_url || null, is_popup ? 1 : 0);
  if (type === 'survey' && Array.isArray(options))
    options.filter(o => (o || '').trim()).forEach((o, i) =>
      db.prepare("INSERT INTO survey_options (announcement_id,option_text,display_order) VALUES (?,?,?)").run(info.lastInsertRowid, o, i));
  res.json({ id: info.lastInsertRowid });
});

// Commander: get sent announcements
app.get('/api/pinkus/commander/announcements', requirePinkusAuth(['commander']), (req, res) => {
  const list = db.prepare("SELECT * FROM announcements WHERE author_id=? ORDER BY id DESC").all(req.session.pinkusUser.id);
  list.forEach(a => {
    a.response_count = db.prepare("SELECT COUNT(*) c FROM survey_responses WHERE announcement_id=?").get(a.id).c;
    if (a.type === 'survey')
      a.options = db.prepare("SELECT id,option_text,(SELECT COUNT(*) FROM survey_responses WHERE option_id=survey_options.id) AS votes FROM survey_options WHERE announcement_id=? ORDER BY display_order").all(a.id);
  });
  res.json(list);
});

/* ---------- Excel export (commander + mefakatz) ---------- */
const EXPORT_FIELDS = {
  full_name: 'שם מלא', username: 'שם משתמש', mefakatz_name: 'מפקץ',
  age: 'גיל', marital_status: 'מצב משפחתי', city: 'עיר', address: 'כתובת',
  phone: 'טלפון', spouse_phone: 'טלפון בן/בת זוג', parents_phone: 'טלפון הורים',
  num_children: 'מספר ילדים', civilian_profession: 'מקצוע אזרחי', shirt_size: 'מידת חולצה', notes: 'הערות'
};
function buildCadetExport(rows, fields) {
  const cols = (fields && fields.length ? fields : Object.keys(EXPORT_FIELDS)).filter(f => EXPORT_FIELDS[f]);
  const out = rows.map(r => { const o = {}; cols.forEach(f => o[EXPORT_FIELDS[f]] = r[f] ?? ''); return o; });
  const ws = XLSX.utils.json_to_sheet(out, { header: cols.map(f => EXPORT_FIELDS[f]) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'צוערים');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const CADET_SELECT = `
  SELECT u.id,u.full_name,u.username,m.full_name AS mefakatz_name,
    d.age,d.marital_status,d.city,d.address,d.phone,d.spouse_phone,d.parents_phone,
    d.num_children,d.civilian_profession,d.shirt_size,d.notes
  FROM users u LEFT JOIN users m ON u.mefakatz_id=m.id
  LEFT JOIN cadet_details d ON d.user_id=u.id WHERE u.role='tzaer'`;
function sendXlsx(res, buf, name) {
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}
app.get('/api/pinkus/commander/export-cadets', requirePinkusAuth(['commander']), (req, res) => {
  const fields = (req.query.fields || '').split(',').filter(Boolean);
  const rows = db.prepare(CADET_SELECT + " ORDER BY mefakatz_name, u.full_name").all();
  sendXlsx(res, buildCadetExport(rows, fields), 'cadets.xlsx');
});
app.get('/api/pinkus/export-cadets', requirePinkusAuth(['mefakatz', 'commander']), (req, res) => {
  const fields = (req.query.fields || '').split(',').filter(Boolean);
  const u = req.session.pinkusUser;
  const rows = u.role === 'commander'
    ? db.prepare(CADET_SELECT + " ORDER BY u.full_name").all()
    : db.prepare(CADET_SELECT + " AND u.mefakatz_id=? ORDER BY u.full_name").all(u.id);
  sendXlsx(res, buildCadetExport(rows, fields), 'cadets.xlsx');
});

/* ---------- Mefakatz ---------- */
app.get('/api/pinkus/mefakatz/cadets', requirePinkusAuth(['mefakatz']), (req, res) => {
  const mid = req.session.pinkusUser.id;
  res.json(db.prepare(`
    SELECT u.id,u.full_name,u.username,u.active,
      d.age,d.marital_status,d.city,d.address,d.phone,d.spouse_phone,d.parents_phone,
      d.num_children,d.civilian_profession,d.shirt_size,d.notes
    FROM users u LEFT JOIN cadet_details d ON d.user_id=u.id
    WHERE u.role='tzaer' AND u.mefakatz_id=? ORDER BY u.full_name`).all(mid));
});

function ensureCadetOfMef(req, res, id) {
  const c = db.prepare("SELECT * FROM users WHERE id=? AND role='tzaer' AND mefakatz_id=?").get(id, req.session.pinkusUser.id);
  if (!c) { res.status(404).json({ error: 'not_found' }); return null; }
  return c;
}

app.get('/api/pinkus/mefakatz/cadets/:id/record', requirePinkusAuth(['mefakatz']), (req, res) => {
  if (!ensureCadetOfMef(req, res, req.params.id)) return;
  const r = db.prepare("SELECT data FROM cadet_records WHERE cadet_id=? ORDER BY id DESC LIMIT 1").get(req.params.id);
  res.json({ data: r ? JSON.parse(r.data) : null });
});

app.put('/api/pinkus/mefakatz/cadets/:id/record', requirePinkusAuth(['mefakatz']), (req, res) => {
  if (!ensureCadetOfMef(req, res, req.params.id)) return;
  const mid = req.session.pinkusUser.id;
  const data = JSON.stringify(req.body.data ?? {});
  const ex = db.prepare("SELECT id FROM cadet_records WHERE cadet_id=? ORDER BY id DESC LIMIT 1").get(req.params.id);
  if (ex) db.prepare("UPDATE cadet_records SET data=?,updated_at=datetime('now') WHERE id=?").run(data, ex.id);
  else db.prepare("INSERT INTO cadet_records (cadet_id,mefakatz_id,data,updated_at) VALUES (?,?,?,datetime('now'))").run(req.params.id, mid, data);
  res.json({ ok: true });
});

app.get('/api/pinkus/mefakatz/exams', requirePinkusAuth(['mefakatz']), (req, res) => {
  res.json(db.prepare("SELECT * FROM exams WHERE mefakatz_id=? ORDER BY date DESC, id DESC").all(req.session.pinkusUser.id));
});
app.post('/api/pinkus/mefakatz/exams', requirePinkusAuth(['mefakatz']), (req, res) => {
  const { name, date } = req.body || {};
  const info = db.prepare("INSERT INTO exams (mefakatz_id,name,date) VALUES (?,?,?)").run(req.session.pinkusUser.id, name || '', date || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/pinkus/mefakatz/exams/:id', requirePinkusAuth(['mefakatz']), (req, res) => {
  const e = db.prepare("SELECT * FROM exams WHERE id=? AND mefakatz_id=?").get(req.params.id, req.session.pinkusUser.id);
  if (!e) return res.status(404).json({ error: 'not_found' });
  const { name, date, published } = req.body || {};
  db.prepare("UPDATE exams SET name=?,date=?,published=? WHERE id=?")
    .run(name ?? e.name, date ?? e.date, published != null ? (published ? 1 : 0) : e.published, e.id);
  res.json({ ok: true });
});
app.get('/api/pinkus/mefakatz/exams/:id/grades', requirePinkusAuth(['mefakatz']), (req, res) => {
  const e = db.prepare("SELECT * FROM exams WHERE id=? AND mefakatz_id=?").get(req.params.id, req.session.pinkusUser.id);
  if (!e) return res.status(404).json({ error: 'not_found' });
  res.json(db.prepare(`
    SELECT u.id AS cadet_id, u.full_name, g.grade, g.notes
    FROM users u
    LEFT JOIN exam_grades g ON g.cadet_id=u.id AND g.exam_id=?
    WHERE u.role='tzaer' AND u.mefakatz_id=? ORDER BY u.full_name`).all(e.id, req.session.pinkusUser.id));
});
app.put('/api/pinkus/mefakatz/exams/:id/grades', requirePinkusAuth(['mefakatz']), (req, res) => {
  const e = db.prepare("SELECT * FROM exams WHERE id=? AND mefakatz_id=?").get(req.params.id, req.session.pinkusUser.id);
  if (!e) return res.status(404).json({ error: 'not_found' });
  const list = Array.isArray(req.body) ? req.body : (req.body.grades || []);
  const up = db.transaction(arr => {
    for (const g of arr) {
      const ex = db.prepare("SELECT id FROM exam_grades WHERE exam_id=? AND cadet_id=?").get(e.id, g.cadet_id);
      const grade = (g.grade === '' || g.grade == null) ? null : Number(g.grade);
      if (ex) db.prepare("UPDATE exam_grades SET grade=?,notes=? WHERE id=?").run(grade, g.notes || '', ex.id);
      else db.prepare("INSERT INTO exam_grades (exam_id,cadet_id,grade,notes) VALUES (?,?,?,?)").run(e.id, g.cadet_id, grade, g.notes || '');
    }
  });
  up(list);
  res.json({ ok: true });
});

app.get('/api/pinkus/mefakatz/materials', requirePinkusAuth(['mefakatz']), (req, res) => {
  res.json(db.prepare("SELECT * FROM materials WHERE mefakatz_id=? ORDER BY stage, id DESC").all(req.session.pinkusUser.id));
});
app.post('/api/pinkus/mefakatz/materials', requirePinkusAuth(['mefakatz']), (req, res) => {
  const { title, content, type, stage, published, due_date } = req.body || {};
  const info = db.prepare("INSERT INTO materials (mefakatz_id,title,content,type,stage,published,due_date) VALUES (?,?,?,?,?,?,?)")
    .run(req.session.pinkusUser.id, title || '', content || '', type || 'material', stage || 1, published ? 1 : 0, due_date || null);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/pinkus/mefakatz/materials/:id', requirePinkusAuth(['mefakatz']), (req, res) => {
  const m = db.prepare("SELECT * FROM materials WHERE id=? AND mefakatz_id=?").get(req.params.id, req.session.pinkusUser.id);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const { title, content, type, stage, published, due_date } = req.body || {};
  db.prepare("UPDATE materials SET title=?,content=?,type=?,stage=?,published=?,due_date=? WHERE id=?")
    .run(title ?? m.title, content ?? m.content, type ?? m.type, stage ?? m.stage,
         published != null ? (published ? 1 : 0) : m.published, due_date !== undefined ? due_date : m.due_date, m.id);
  res.json({ ok: true });
});
app.delete('/api/pinkus/mefakatz/materials/:id', requirePinkusAuth(['mefakatz']), (req, res) => {
  db.prepare("DELETE FROM materials WHERE id=? AND mefakatz_id=?").run(req.params.id, req.session.pinkusUser.id);
  res.json({ ok: true });
});

app.post('/api/pinkus/mefakatz/announce', requirePinkusAuth(['mefakatz']), (req, res) => {
  const { scope, target_id, type, title, content, link_url, options } = req.body || {};
  const mid = req.session.pinkusUser.id;
  const sc = scope === 'personal' ? 'personal' : 'mefakatz_cadets';
  const info = db.prepare(`INSERT INTO announcements (author_id,scope,target_id,mefakatz_scope_id,type,title,content,link_url)
    VALUES (?,?,?,?,?,?,?,?)`).run(mid, sc, sc === 'personal' ? (target_id || null) : null, mid, type || 'message', title || '', content || '', link_url || null);
  if (type === 'survey' && Array.isArray(options))
    options.filter(o => (o || '').trim()).forEach((o, i) =>
      db.prepare("INSERT INTO survey_options (announcement_id,option_text,display_order) VALUES (?,?,?)").run(info.lastInsertRowid, o, i));
  res.json({ id: info.lastInsertRowid });
});

// Mefakatz: inbox (own sent + commander messages to mefakatzim)
app.get('/api/pinkus/mefakatz/inbox', requirePinkusAuth(['mefakatz']), (req, res) => {
  const u = req.session.pinkusUser;
  const mef = db.prepare("SELECT team_id FROM users WHERE id=?").get(u.id);
  const team_id = mef ? mef.team_id : null;
  const list = db.prepare(`
    SELECT * FROM announcements
    WHERE scope='all_mefakatzim'
       OR (scope='team_mefakatzim' AND team_scope_id=?)
       OR (scope='personal' AND target_id=?)
    ORDER BY id DESC`).all(team_id, u.id);
  res.json(list);
});

app.get('/api/pinkus/mefakatz/announcements', requirePinkusAuth(['mefakatz']), (req, res) => {
  const list = db.prepare("SELECT * FROM announcements WHERE author_id=? ORDER BY id DESC").all(req.session.pinkusUser.id);
  for (const a of list) {
    a.response_count = db.prepare("SELECT COUNT(*) c FROM survey_responses WHERE announcement_id=?").get(a.id).c;
    if (a.type === 'survey') {
      a.options = db.prepare("SELECT id,option_text FROM survey_options WHERE announcement_id=? ORDER BY display_order").all(a.id);
      a.options.forEach(o => o.votes = db.prepare("SELECT COUNT(*) c FROM survey_responses WHERE option_id=?").get(o.id).c);
    }
  }
  res.json(list);
});

/* ---------- Cadet (tzaer) ---------- */
app.get('/api/pinkus/tzaer/profile', requirePinkusAuth(['tzaer']), (req, res) => {
  const uid = req.session.pinkusUser.id;
  let d = db.prepare("SELECT * FROM cadet_details WHERE user_id=?").get(uid);
  if (!d) { db.prepare("INSERT INTO cadet_details (user_id,updated_at) VALUES (?,datetime('now'))").run(uid); d = db.prepare("SELECT * FROM cadet_details WHERE user_id=?").get(uid); }
  d.full_name = req.session.pinkusUser.full_name;
  res.json(d);
});
app.put('/api/pinkus/tzaer/profile', requirePinkusAuth(['tzaer']), (req, res) => {
  const uid = req.session.pinkusUser.id;
  const b = req.body || {};
  db.prepare("INSERT OR IGNORE INTO cadet_details (user_id,updated_at) VALUES (?,datetime('now'))").run(uid);
  db.prepare(`UPDATE cadet_details SET age=?,marital_status=?,city=?,address=?,phone=?,spouse_phone=?,
    parents_phone=?,num_children=?,civilian_profession=?,shirt_size=?,notes=?,updated_at=datetime('now') WHERE user_id=?`)
    .run(b.age || null, b.marital_status || null, b.city || null, b.address || null, b.phone || null, b.spouse_phone || null,
         b.parents_phone || null, b.num_children || null, b.civilian_profession || null, b.shirt_size || null, b.notes || null, uid);
  res.json({ ok: true });
});
app.get('/api/pinkus/tzaer/materials', requirePinkusAuth(['tzaer']), (req, res) => {
  const mid = req.session.pinkusUser.mefakatz_id;
  res.json(db.prepare("SELECT * FROM materials WHERE mefakatz_id=? AND type='material' AND published=1 ORDER BY stage, id DESC").all(mid));
});
app.get('/api/pinkus/tzaer/assignments', requirePinkusAuth(['tzaer']), (req, res) => {
  const u = req.session.pinkusUser;
  const list = db.prepare("SELECT * FROM materials WHERE mefakatz_id=? AND type='assignment' AND published=1 ORDER BY id DESC").all(u.mefakatz_id);
  list.forEach(m => {
    const s = db.prepare("SELECT * FROM assignment_submissions WHERE material_id=? AND cadet_id=?").get(m.id, u.id);
    m.status = s ? s.status : 'pending';
    m.submission_text = s ? s.submission_text : '';
  });
  res.json(list);
});
app.post('/api/pinkus/tzaer/assignments/:id/submit', requirePinkusAuth(['tzaer']), (req, res) => {
  const u = req.session.pinkusUser;
  const m = db.prepare("SELECT * FROM materials WHERE id=? AND mefakatz_id=? AND type='assignment'").get(req.params.id, u.mefakatz_id);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const txt = (req.body || {}).submission_text || '';
  const ex = db.prepare("SELECT id FROM assignment_submissions WHERE material_id=? AND cadet_id=?").get(m.id, u.id);
  if (ex) db.prepare("UPDATE assignment_submissions SET status='submitted',submission_text=?,submitted_at=datetime('now') WHERE id=?").run(txt, ex.id);
  else db.prepare("INSERT INTO assignment_submissions (material_id,cadet_id,status,submission_text,submitted_at) VALUES (?,?,'submitted',?,datetime('now'))").run(m.id, u.id, txt);
  res.json({ ok: true });
});
app.get('/api/pinkus/tzaer/grades', requirePinkusAuth(['tzaer']), (req, res) => {
  const u = req.session.pinkusUser;
  const exams = db.prepare(`
    SELECT e.id,e.name,e.date,g.grade,g.notes,'exam' AS kind
    FROM exams e LEFT JOIN exam_grades g ON g.exam_id=e.id AND g.cadet_id=?
    WHERE e.mefakatz_id=? AND e.published=1 ORDER BY e.date DESC, e.id DESC`).all(u.id, u.mefakatz_id);
  const rating = db.prepare(`SELECT score,notes FROM cadet_ratings WHERE cadet_id=?`).get(u.id);
  const cmdGrade = db.prepare(`SELECT score,notes FROM commander_grades WHERE cadet_id=?`).get(u.id);
  const summary = [];
  if (rating && rating.score != null) summary.push({ name:'ציון מפקץ', grade: rating.score, notes: rating.notes||'', kind:'summary' });
  if (cmdGrade && cmdGrade.score != null) summary.push({ name:'ציון מפקד קורס', grade: cmdGrade.score, notes: cmdGrade.notes||'', kind:'summary' });
  res.json([...summary, ...exams]);
});
app.get('/api/pinkus/tzaer/announcements', requirePinkusAuth(['tzaer']), (req, res) => {
  const u = req.session.pinkusUser;
  const mef = u.mefakatz_id ? db.prepare("SELECT team_id FROM users WHERE id=?").get(u.mefakatz_id) : null;
  const team_id = mef ? mef.team_id : null;
  const list = db.prepare(`
    SELECT * FROM announcements
    WHERE scope='all_cadets'
       OR (scope='mefakatz_cadets' AND mefakatz_scope_id=?)
       OR (scope='team_cadets' AND team_scope_id=?)
       OR (scope='personal' AND target_id=?)
    ORDER BY id DESC`).all(u.mefakatz_id, team_id, u.id);
  for (const a of list) {
    if (a.type === 'survey') {
      a.options = db.prepare("SELECT id,option_text FROM survey_options WHERE announcement_id=? ORDER BY display_order").all(a.id);
      const r = db.prepare("SELECT option_id FROM survey_responses WHERE announcement_id=? AND user_id=?").get(a.id, u.id);
      a.my_response = r ? r.option_id : null;
      a.options.forEach(o => o.votes = db.prepare("SELECT COUNT(*) c FROM survey_responses WHERE option_id=?").get(o.id).c);
    }
  }
  res.json(list);
});
app.post('/api/pinkus/tzaer/announcements/:id/respond', requirePinkusAuth(['tzaer']), (req, res) => {
  const u = req.session.pinkusUser;
  const { option_id } = req.body || {};
  const opt = db.prepare("SELECT * FROM survey_options WHERE id=? AND announcement_id=?").get(option_id, req.params.id);
  if (!opt) return res.status(400).json({ error: 'bad_option' });
  db.prepare("INSERT OR REPLACE INTO survey_responses (announcement_id,option_id,user_id,created_at) VALUES (?,?,?,datetime('now'))")
    .run(req.params.id, option_id, u.id);
  res.json({ ok: true });
});

/* ---------- Teams (commander) ---------- */
app.get('/api/pinkus/teams', requirePinkusAuth(['commander']), (req, res) => {
  const rows = db.prepare("SELECT t.id,t.name,t.staff,(SELECT COUNT(*) FROM users WHERE team_id=t.id AND role='mefakatz') AS mef_count FROM teams t ORDER BY t.name").all();
  res.json(rows.map(r => ({ ...r, staff: JSON.parse(r.staff || '[]') })));
});
app.post('/api/pinkus/teams', requirePinkusAuth(['commander']), (req, res) => {
  const { name, staff } = req.body || {};
  if (!name) return res.status(400).json({ error: 'bad_request' });
  try {
    const info = db.prepare("INSERT INTO teams (name,staff) VALUES (?,?)").run(name, JSON.stringify(staff||[]));
    res.json({ id: info.lastInsertRowid });
  } catch(e) { res.status(409).json({ error: 'duplicate' }); }
});
app.put('/api/pinkus/teams/:id', requirePinkusAuth(['commander']), (req, res) => {
  const { name, staff } = req.body || {};
  db.prepare("UPDATE teams SET name=?,staff=? WHERE id=?").run(name || '', JSON.stringify(staff||[]), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/pinkus/teams/:id', requirePinkusAuth(['commander']), (req, res) => {
  db.prepare("UPDATE users SET team_id=NULL WHERE team_id=?").run(req.params.id);
  db.prepare("DELETE FROM teams WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Commander: assign mefakatz to team
app.put('/api/pinkus/users/:id/team', requirePinkusAuth(['commander']), (req, res) => {
  db.prepare("UPDATE users SET team_id=? WHERE id=? AND role='mefakatz'").run(req.body.team_id || null, req.params.id);
  res.json({ ok: true });
});

// Commander: view all cadets with grades + ratings
app.get('/api/pinkus/commander/cadets-grades', requirePinkusAuth(['commander']), (req, res) => {
  res.json(db.prepare(`
    SELECT u.id,u.full_name,m.full_name AS mefakatz_name,t.name AS team_name,
      cg.score AS cmd_score, cg.notes AS cmd_notes,
      cr.score AS mef_score, cr.notes AS mef_notes
    FROM users u
    LEFT JOIN users m ON u.mefakatz_id=m.id
    LEFT JOIN teams t ON m.team_id=t.id
    LEFT JOIN commander_grades cg ON cg.cadet_id=u.id
    LEFT JOIN cadet_ratings cr ON cr.cadet_id=u.id
    WHERE u.role='tzaer' ORDER BY t.name, m.full_name, u.full_name`).all());
});

// Commander: upsert grade for a cadet
app.put('/api/pinkus/commander/cadets/:id/grade', requirePinkusAuth(['commander']), (req, res) => {
  const { score, notes } = req.body || {};
  db.prepare(`INSERT INTO commander_grades (cadet_id,score,notes,updated_at) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(cadet_id) DO UPDATE SET score=excluded.score,notes=excluded.notes,updated_at=excluded.updated_at`)
    .run(req.params.id, score ?? null, notes || '');
  res.json({ ok: true });
});

// Mefakatz: get cadet rating
app.get('/api/pinkus/mefakatz/cadets/:id/rating', requirePinkusAuth(['mefakatz']), (req, res) => {
  if (!ensureCadetOfMef(req, res, req.params.id)) return;
  const r = db.prepare("SELECT score,notes FROM cadet_ratings WHERE cadet_id=?").get(req.params.id);
  res.json(r || { score: 0, notes: '' });
});

// Mefakatz: rate a cadet
app.put('/api/pinkus/mefakatz/cadets/:id/rating', requirePinkusAuth(['mefakatz']), (req, res) => {
  if (!ensureCadetOfMef(req, res, req.params.id)) return;
  const { score, notes } = req.body || {};
  db.prepare(`INSERT INTO cadet_ratings (cadet_id,mefakatz_id,score,notes,updated_at) VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(cadet_id) DO UPDATE SET score=excluded.score,notes=excluded.notes,updated_at=excluded.updated_at`)
    .run(req.params.id, req.session.pinkusUser.id, score ?? null, notes || '');
  res.json({ ok: true });
});

// Mefakatz: get own team info
app.get('/api/pinkus/mefakatz/me', requirePinkusAuth(['mefakatz']), (req, res) => {
  const u = db.prepare("SELECT u.full_name,t.name AS team_name FROM users u LEFT JOIN teams t ON u.team_id=t.id WHERE u.id=?").get(req.session.pinkusUser.id);
  res.json(u || {});
});

/* ---------- Ogden chapters ---------- */
// List all chapters (with this mefakatz's visibility)
app.get('/api/pinkus/mefakatz/ogden', requirePinkusAuth(['mefakatz']), (req, res) => {
  const mid = req.session.pinkusUser.id;
  const rows = db.prepare(`
    SELECT c.*, COALESCE(v.visible,0) AS visible
    FROM ogden_chapters c
    LEFT JOIN ogden_visibility v ON v.chapter_id=c.id AND v.mefakatz_id=?
    ORDER BY c.sort_order`).all(mid);
  res.json(rows);
});

// Toggle chapter visibility for this mefakatz
app.put('/api/pinkus/mefakatz/ogden/:id', requirePinkusAuth(['mefakatz']), (req, res) => {
  const mid = req.session.pinkusUser.id;
  const { visible } = req.body || {};
  db.prepare(`INSERT INTO ogden_visibility (mefakatz_id,chapter_id,visible) VALUES (?,?,?)
    ON CONFLICT(mefakatz_id,chapter_id) DO UPDATE SET visible=excluded.visible`)
    .run(mid, req.params.id, visible ? 1 : 0);
  res.json({ ok: true });
});

// Cadet: get chapters visible to them (via their mefakatz)
app.get('/api/pinkus/tzaer/ogden', requirePinkusAuth(['tzaer']), (req, res) => {
  const uid = req.session.pinkusUser.id;
  const cadet = db.prepare("SELECT mefakatz_id FROM users WHERE id=?").get(uid);
  if (!cadet?.mefakatz_id) return res.json([]);
  const rows = db.prepare(`
    SELECT c.name, c.week, c.url, c.start_page, c.end_page
    FROM ogden_chapters c
    JOIN ogden_visibility v ON v.chapter_id=c.id AND v.mefakatz_id=? AND v.visible=1
    ORDER BY c.sort_order`).all(cadet.mefakatz_id);
  res.json(rows);
});

// Public: teams list (for dropdowns)
app.get('/api/pinkus/teams-public', (req, res) => {
  res.json(db.prepare("SELECT id,name FROM teams ORDER BY name").all());
});

// Update mefakatzim list to include team
app.get('/api/pinkus/mefakatzim', (req, res) => {
  res.json(db.prepare("SELECT u.id,u.full_name,u.username,t.name AS team_name FROM users u LEFT JOIN teams t ON u.team_id=t.id WHERE u.role='mefakatz' AND u.active=1 ORDER BY u.full_name").all());
});

/* ---------- Page routes ---------- */
app.get('/pinkus', (req, res) => res.sendFile(path.join(__dirname, 'pinkus-login.html')));
app.get('/pinkus/commander', (req, res) => res.sendFile(path.join(__dirname, 'pinkus-commander.html')));
app.get('/pinkus/mefakatz', (req, res) => res.sendFile(path.join(__dirname, 'pinkus-mefakatz.html')));
app.get('/pinkus/tzaer', (req, res) => res.sendFile(path.join(__dirname, 'pinkus-tzaer.html')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'alufei_kayitz.html'));
});

const DATA_FILE = path.join(__dirname, 'users_data.json');

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

// קרא את כל המשתמשים
app.get('/api/users', (req, res) => {
  res.json(readData());
});

// עדכן משתמש בודד
app.post('/api/users/:username', (req, res) => {
  const data = readData();
  data[req.params.username] = req.body;
  writeData(data);
  res.json({ok: true});
});

// מחק משתמש
app.delete('/api/users/:username', (req, res) => {
  const data = readData();
  delete data[req.params.username];
  writeData(data);
  res.json({ok: true});
});

// Proxy route to Anthropic API
app.post('/api/chat', async (req, res) => {
  const { apiKey, messages, system } = req.body;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

const PORT = process.env.PORT || 3030;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
