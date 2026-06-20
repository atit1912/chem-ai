// ============================================================
// ChemNexus AI 3.0 — firebase-config.js
// วางไฟล์นี้ที่ root ของ GitHub Pages repo (chem-ai/)
// Developed by Atit Chimnan
// ============================================================

// ── Firebase Configuration ───────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBjrH3eDLLa7F6b2VLuVLnE_bKqyo0ob8I",
  authDomain:        "chemnexus-ai-v3.firebaseapp.com",
  projectId:         "chemnexus-ai-v3",
  storageBucket:     "chemnexus-ai-v3.firebasestorage.app",
  messagingSenderId: "564959906720",
  appId:             "1:564959906720:web:1a73e365c8de21ea0df2c5",
  measurementId:     "G-1H2C7X4173"
};

// ── Farm Constants ───────────────────────────────────────────
const FARMS = [
  { id: 'farm_hk',  name: 'ศูนย์วิจัยหัวกุญแจ',               short: 'หัวกุญแจ', icon: '🔑' },
  { id: 'farm_rs',  name: 'ศูนย์วิจัยไร่สาม',                  short: 'ไร่สาม',   icon: '🌾' },
  { id: 'farm_hj',  name: 'ศูนย์วิจัยหาดเจ้า',                short: 'หาดเจ้า', icon: '🌊' },
  { id: 'farm_pb',  name: 'ศูนย์วิจัยเพชรบุรี',                short: 'เพชรบุรี',icon: '💎' },
  { id: 'farm_pps', name: 'ศูนย์ปรับปรุงพันธุ์สัตว์น้ำหาดเจ้า', short: 'ศปพ.',   icon: '🐟' },
];

// ── Initialize Firebase ──────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db        = firebase.firestore();
const analytics = firebase.analytics();

// Enable offline persistence (PWA)
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ── Session State ────────────────────────────────────────────
let currentFarm = null;

function getCurrentFarm() {
  if (currentFarm) return currentFarm;
  const saved = localStorage.getItem('cnx3_farm');
  if (saved) currentFarm = FARMS.find(f => f.id === saved) || null;
  return currentFarm;
}

function setCurrentFarm(farmId) {
  currentFarm = FARMS.find(f => f.id === farmId) || null;
  if (currentFarm) localStorage.setItem('cnx3_farm', farmId);
  return currentFarm;
}

function clearCurrentFarm() {
  currentFarm = null;
  localStorage.removeItem('cnx3_farm');
}

// ── Firestore References ─────────────────────────────────────
const farmDoc      = (fid) => db.collection('farms').doc(fid);
const chemicalsCol = (fid) => farmDoc(fid).collection('chemicals');
const auditCol     = (fid) => farmDoc(fid).collection('audit');
const sharedChems  = ()    => db.collection('shared').doc('chemicals').collection('items');
const countersDoc  = ()    => db.collection('analytics').doc('counters');
const configDoc    = ()    => db.collection('config').doc('farms');

// ── PIN Helpers ──────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyFarmPIN(farmId, pin) {
  try {
    const doc = await configDoc().get();
    if (doc.exists) {
      const stored = doc.data()[farmId]?.pin;
      if (!stored) return pin === '1234';  // default
      if (stored === pin) return true;
      return stored === await sha256(pin);
    }
    return pin === '1234';
  } catch(e) {
    console.warn('[CNX] PIN verify error:', e);
    return pin === '1234';
  }
}

async function changeFarmPIN(farmId, newPin) {
  const hash = await sha256(newPin);
  await configDoc().set({ [farmId]: { pin: hash } }, { merge: true });
}

// ── Chemical CRUD ────────────────────────────────────────────

// โหลดสารเคมีทั้งหมด (farm-specific + shared)
async function loadChemicals(farmId) {
  const fid = farmId || getCurrentFarm()?.id;
  if (!fid) return [];
  try {
    const [farmSnap, sharedSnap] = await Promise.all([
      chemicalsCol(fid).where('active','==',true).orderBy('name').get(),
      sharedChems().where('active','==',true).orderBy('name').get(),
    ]);
    const farmList   = farmSnap.docs.map(d => ({ ...d.data(), _id: d.id, _src: 'farm' }));
    const sharedList = sharedSnap.docs.map(d => ({ ...d.data(), _id: d.id, _src: 'shared' }));
    // Farm chemicals override shared ถ้าชื่อซ้ำ
    const farmNames  = new Set(farmList.map(c => c.name));
    return [...farmList, ...sharedList.filter(c => !farmNames.has(c.name))];
  } catch(e) {
    console.warn('[CNX] loadChemicals error:', e);
    return [];
  }
}

// เพิ่มสารเคมีเฉพาะฟาร์ม
async function addChemical(name, cls, cas = '', hsNumbers = '') {
  const fid = getCurrentFarm()?.id;
  if (!fid) throw new Error('No farm selected');
  const ref = await chemicalsCol(fid).add({
    name, class: cls, cas, hsNumbers,
    active: true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: fid,
  });
  return ref.id;
}

// แก้ไขสารเคมี
async function updateChemical(docId, data) {
  const fid = getCurrentFarm()?.id;
  if (!fid) return;
  await chemicalsCol(fid).doc(docId).update({
    ...data,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ลบสารเคมี (soft delete)
async function deleteChemical(docId) {
  const fid = getCurrentFarm()?.id;
  if (!fid) return;
  await chemicalsCol(fid).doc(docId).update({
    active: false,
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Audit Log ────────────────────────────────────────────────
async function logAudit({ chemA, clsA, chemB, clsB, result }) {
  const farm = getCurrentFarm();
  if (!farm) return;
  try {
    await auditCol(farm.id).add({
      chemA, clsA, chemB, clsB, result,
      farmId:   farm.id,
      farmName: farm.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await trackScan();
  } catch(e) {
    console.warn('[CNX] logAudit error:', e);
  }
}

// ดึง audit log ของฟาร์ม (ล่าสุด n รายการ)
async function getAuditLog(farmId, limit = 50) {
  const fid = farmId || getCurrentFarm()?.id;
  if (!fid) return [];
  try {
    const snap = await auditCol(fid)
      .orderBy('createdAt','desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ ...d.data(), _id: d.id }));
  } catch(e) {
    return [];
  }
}

// ── Analytics ────────────────────────────────────────────────
async function trackVisit() {
  const farm = getCurrentFarm();
  try {
    await countersDoc().set({
      totalVisits: firebase.firestore.FieldValue.increment(1),
      [`visits_${farm?.id || 'unknown'}`]: firebase.firestore.FieldValue.increment(1),
      lastVisit: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch(e) {}
}

async function trackScan() {
  const farm = getCurrentFarm();
  try {
    await countersDoc().set({
      totalScans: firebase.firestore.FieldValue.increment(1),
      [`scans_${farm?.id || 'unknown'}`]: firebase.firestore.FieldValue.increment(1),
      lastScan: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch(e) {}
}

// Real-time counter listener
function listenAnalytics(callback) {
  return countersDoc().onSnapshot(doc => {
    if (doc.exists) callback(doc.data());
  }, () => {});
}

// ── First-time Setup ─────────────────────────────────────────
// รัน setupFarms() ครั้งเดียวใน browser console หลัง deploy
async function setupFarms() {
  const batch = db.batch();

  // สร้าง farm config + default PIN (hash ของ '1234')
  const defaultHash = await sha256('1234');
  const farmConfig  = {};
  FARMS.forEach(f => {
    farmConfig[f.id] = { name: f.name, pin: defaultHash };
  });
  batch.set(configDoc(), farmConfig, { merge: true });

  // สร้าง analytics counter เริ่มต้น
  batch.set(countersDoc(), {
    totalVisits: 0, totalScans: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  console.log('[CNX] ✅ setupFarms() เสร็จแล้ว — PIN default: 1234');
}
