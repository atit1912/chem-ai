// ============================================================
// ChemNexus AI 2.0 — config.js
// วางไฟล์นี้ที่ root ของ GitHub Pages repo
// แก้ GAS_URL หลัง deploy Code.gs เสร็จ
// ============================================================

const CHEMNEXUS_CONFIG = {

  // ── ใส่ URL หลัง deploy GAS Web App ─────────────────────
  // ตัวอย่าง: https://script.google.com/macros/s/AKfy.../exec
  GAS_URL: 'PASTE_YOUR_GAS_URL_HERE',

  // ── App info ──────────────────────────────────────────────
  APP_NAME    : 'ChemNexus AI',
  APP_VERSION : '2.0',
  APP_AUTHOR  : 'ATIT CHIMNAN',

  // ── Default site ที่โหลดตอนเริ่ม ─────────────────────────
  // (user เปลี่ยนได้จาก dropdown — เก็บใน localStorage)
  DEFAULT_SITE_ID: 'site_01',

  // ── Cache TTL (milliseconds) ──────────────────────────────
  // ข้อมูล chemicals จะ cache ไว้ใน localStorage ก่อน fetch ใหม่
  CACHE_TTL_CHEMICALS : 5  * 60 * 1000,  // 5 นาที
  CACHE_TTL_SITES     : 60 * 60 * 1000,  // 1 ชั่วโมง

  // ── Fallback: ถ้า GAS ไม่ตอบ ใช้ local DB แทน ────────────
  USE_LOCAL_FALLBACK: true,

};

// ============================================================
// API CLIENT — ใช้งานทุกที่ใน frontend ผ่าน ChemAPI.xxx()
// ============================================================

const ChemAPI = {

  // ── base fetch wrapper ──────────────────────────────────
  async _get(params) {
    const url = new URL(CHEMNEXUS_CONFIG.GAS_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async _post(body) {
    const res = await fetch(CHEMNEXUS_CONFIG.GAS_URL, {
      method     : 'POST',
      headers    : { 'Content-Type': 'application/json' },
      body       : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // ── Chemicals ───────────────────────────────────────────

  async getChemicals(siteId) {
    const cacheKey = `cnx_chemicals_${siteId || 'all'}`;
    const cached   = getCached_(cacheKey, CHEMNEXUS_CONFIG.CACHE_TTL_CHEMICALS);
    if (cached) return cached;

    try {
      const data = await this._get({ action: 'getChemicals', site_id: siteId || '' });
      setCache_(cacheKey, data.chemicals);
      return data.chemicals;
    } catch(e) {
      console.warn('ChemAPI.getChemicals fallback to local:', e.message);
      return CHEMNEXUS_CONFIG.USE_LOCAL_FALLBACK ? getLocalChemicals_() : [];
    }
  },

  async addChemical(payload) {
    const result = await this._post({ action: 'addChemical', ...payload });
    clearCachePrefix_('cnx_chemicals'); // invalidate cache
    return result;
  },

  async updateChemical(payload) {
    const result = await this._post({ action: 'updateChemical', ...payload });
    clearCachePrefix_('cnx_chemicals');
    return result;
  },

  async deleteChemical(id) {
    const result = await this._post({ action: 'deleteChemical', id });
    clearCachePrefix_('cnx_chemicals');
    return result;
  },

  // ── Audit Log ────────────────────────────────────────────

  async logAudit(payload) {
    // เพิ่ม device info อัตโนมัติ
    const enriched = {
      ...payload,
      device    : navigator.userAgent.slice(0, 80),
      timestamp : new Date().toISOString(),
    };

    // บันทึก local history ก่อนเสมอ (ใช้งาน offline ได้)
    saveLocalAudit_(enriched);

    try {
      return await this._post({ action: 'logAudit', ...enriched });
    } catch(e) {
      console.warn('ChemAPI.logAudit offline — saved locally only:', e.message);
      return { status: 'local_only', message: 'บันทึก local สำเร็จ (offline)' };
    }
  },

  async getAuditLog(filters) {
    return this._get({ action: 'getAuditLog', ...filters });
  },

  // ── Sites ────────────────────────────────────────────────

  async getSites() {
    const cached = getCached_('cnx_sites', CHEMNEXUS_CONFIG.CACHE_TTL_SITES);
    if (cached) return cached;
    try {
      const data = await this._get({ action: 'getSites' });
      setCache_('cnx_sites', data.sites);
      return data.sites;
    } catch(e) {
      return getLocalSites_();
    }
  },

  // ── Config ───────────────────────────────────────────────

  async getConfig() {
    return this._get({ action: 'getConfig' });
  },

  // ── Ping ─────────────────────────────────────────────────

  async ping() {
    try {
      const data = await this._get({ action: 'ping' });
      return { online: true, ...data };
    } catch(e) {
      return { online: false, error: e.message };
    }
  },
};

// ============================================================
// CACHE HELPERS (localStorage)
// ============================================================

function getCached_(key, ttl) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > ttl) return null;
    return data;
  } catch(e) { return null; }
}

function setCache_(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch(e) {}
}

function clearCachePrefix_(prefix) {
  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .forEach(k => localStorage.removeItem(k));
}

// ============================================================
// LOCAL FALLBACKS (ใช้เมื่อ offline หรือ GAS ไม่ตอบ)
// ============================================================

function saveLocalAudit_(entry) {
  try {
    const key  = 'cnx_local_audits';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.unshift(entry);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 50))); // เก็บ 50 รายการล่าสุด
  } catch(e) {}
}

function getLocalChemicals_() {
  // ดึงจาก chemNexusDB (compat กับ v1.0)
  try {
    return JSON.parse(localStorage.getItem('chemNexusDB') || '[]');
  } catch(e) { return []; }
}

function getLocalSites_() {
  return [
    { id:'site_01', name:'ศูนย์วิจัยหัวกุญแจ',       short_name:'HKJ' },
    { id:'site_02', name:'ศูนย์วิจัยไร่สาม',          short_name:'RS'  },
    { id:'site_03', name:'ศูนย์วิจัยหาดเจ้าสำราญ',   short_name:'HJS' },
    { id:'site_04', name:'ศูนย์วิจัยเพชรบุรี',        short_name:'PB'  },
    { id:'site_05', name:'ศปป.สัตว์น้ำ',               short_name:'SN'  },
  ];
}
