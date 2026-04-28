// ============================================
//  FIELDSPEND — Smart Expense Tracker
//  Firebase: Auth + Firestore
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc,
  deleteDoc, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// =====================
// FIREBASE CONFIG
// =====================
const firebaseConfig = {
  apiKey: "AIzaSyAjiozhxjLxgmmUvNN4djntcm-_zYnNqZA",
  authDomain: "dailyspndoffice.firebaseapp.com",
  projectId: "dailyspndoffice",
  storageBucket: "dailyspndoffice.firebasestorage.app",
  messagingSenderId: "467395425317",
  appId: "1:467395425317:web:7d410c445db33d1dc8fbcc",
  measurementId: "G-7QL5ZS3KD8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// =====================
// STATE
// =====================
let currentUser = null;
let expenses = [];
let userBudget = 15000;
let editingExpenseId = null;
let currentFilter = "";
let settleTarget = null;
let pendingSignup = null; // Holds form data while modal is open
let unsubExpenses = null; // Real-time sync listener
let unsubUser = null;     // Real-time sync listener

// =====================
// CATEGORY CONFIG
// =====================
const CAT_CONFIG = {
  Hotel: { icon: "🏨", color: "cat-hotel", barColor: "#3b82f6" },
  Food: { icon: "🍽️", color: "cat-food", barColor: "#f59e0b" },
  Travel: { icon: "🚗", color: "cat-travel", barColor: "#10b981" },
  Fuel: { icon: "⛽", color: "cat-fuel", barColor: "#ef4444" },
  Stationery: { icon: "📎", color: "cat-stationery", barColor: "#a855f7" },
  Communication: { icon: "📱", color: "cat-communication", barColor: "#06b6d4" },
  Entertainment: { icon: "🎭", color: "cat-entertainment", barColor: "#fb923c" },
  Medical: { icon: "💊", color: "cat-medical", barColor: "#ef4444" },
  Other: { icon: "📦", color: "cat-other", barColor: "#64748b" },
};

// =====================
// UTILS
// =====================

// Local Timezone Date Fix
function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtDate(dateStr) {
  const d = new Date((dateStr || todayStr()) + "T00:00:00");
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dateStr === todayStr()) return "Today";
  
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateStr === yesterdayStr) return "Yesterday";
  
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmt(amount) {
  return "₹" + Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

function showToast(msg, type = "default") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = "toast hidden", 3000);
}

function setGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = currentUser?.displayName?.split(" ")[0] || "there";
  document.getElementById("greeting-text").textContent = `${g}, ${name}! 👋`;
}

const getAmt = (e) => e.effectiveAmount !== undefined ? e.effectiveAmount : e.amount;

// =====================
// AUTH & MODAL LOGIC
// =====================
const SECRET_CODE = "GauravDev18"; 

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    document.getElementById(tab + "-form").classList.add("active");
    document.getElementById("auth-error").textContent = "";
  });
});

// 1. Triggers Modal for Standard Signup
document.getElementById("signup-btn").addEventListener("click", () => {
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const pass = document.getElementById("signup-password").value;
  const err = document.getElementById("auth-error");

  if (!name || !email || !pass) { err.textContent = "Please fill all fields."; return; }
  if (pass.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }

  err.textContent = "";
  pendingSignup = { type: 'email', name, email, pass };
  
  // Show Sweet Popup Modal
  document.getElementById("modal-secret-code").value = "";
  document.getElementById("secret-error").textContent = "";
  document.getElementById("secret-code-modal").classList.remove("hidden");
});

// 2. Triggers Modal for Google Signup
document.getElementById("google-signup-btn").addEventListener("click", () => {
  pendingSignup = { type: 'google' };
  
  // Show Sweet Popup Modal
  document.getElementById("modal-secret-code").value = "";
  document.getElementById("secret-error").textContent = "";
  document.getElementById("secret-code-modal").classList.remove("hidden");
});

// 3. Handle Modal Cancel
document.getElementById("secret-cancel-btn").addEventListener("click", () => {
  document.getElementById("secret-code-modal").classList.add("hidden");
  pendingSignup = null;
});

// 4. Handle Modal Confirmation (Executes the actual signup)
document.getElementById("secret-confirm-btn").addEventListener("click", async () => {
  const codeInput = document.getElementById("modal-secret-code").value;
  const err = document.getElementById("secret-error");
  const mainErr = document.getElementById("auth-error");

  if (codeInput !== SECRET_CODE) {
    err.textContent = "Invalid secret code.";
    return;
  }

  // Code matches, close modal and process
  err.textContent = "";
  document.getElementById("secret-code-modal").classList.add("hidden");
  const btn = document.getElementById("secret-confirm-btn");
  btn.textContent = "Creating Account..."; btn.disabled = true;

  if (pendingSignup.type === 'email') {
    try {
      const cred = await createUserWithEmailAndPassword(auth, pendingSignup.email, pendingSignup.pass);
      await updateProfile(cred.user, { displayName: pendingSignup.name });
      await addDoc(collection(db, "users"), {
        uid: cred.user.uid, name: pendingSignup.name, email: pendingSignup.email, budget: 15000, createdAt: serverTimestamp()
      });
      showToast("Account created! Welcome 🎉", "success");
    } catch (e) {
      mainErr.textContent = e.message.replace("Firebase: ", "");
    }
  } else if (pendingSignup.type === 'google') {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Assume success and let Firebase rules handle the rest
      await addDoc(collection(db, "users"), {
        uid: user.uid, name: user.displayName, email: user.email,
        budget: 15000, createdAt: serverTimestamp()
      }).catch(err => {
        // If doc already exists, it's fine, rule will block and we move on.
        console.log("Google User already exists in DB");
      });
    } catch (e) {
      mainErr.textContent = e.message.replace("Firebase: ", "");
    }
  }
  
  btn.textContent = "Verify & Continue"; btn.disabled = false;
  pendingSignup = null;
});

// 5. Standard Login (No modal required)
document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value;
  const err = document.getElementById("auth-error");
  if (!email || !pass) { err.textContent = "Enter email and password."; return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    err.textContent = "Invalid email or password.";
  }
});

// 6. Google Login
document.getElementById("google-login-btn").addEventListener("click", async () => {
  const err = document.getElementById("auth-error");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    err.textContent = e.message.replace("Firebase: ", "");
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));
document.getElementById("settings-logout-btn").addEventListener("click", () => signOut(auth));

// =====================
// REAL-TIME SYNC & AUTH STATE
// =====================
function startRealtimeSync() {
  // 1. Sync User Data (Budget, Profile) instantly
  const userQ = query(collection(db, "users"), where("uid", "==", currentUser.uid));
  unsubUser = onSnapshot(userQ, (snap) => {
    if (!snap.empty) {
      userBudget = snap.docs[0].data().budget || 15000;
    }
    const name = currentUser.displayName || "User";
    const email = currentUser.email || "";
    const initial = name.charAt(0).toUpperCase();
    
    document.getElementById("user-avatar").textContent = initial;
    document.getElementById("user-name-display").textContent = name;
    document.getElementById("user-email-display").textContent = email;
    document.getElementById("settings-avatar").textContent = initial;
    document.getElementById("settings-name").textContent = name;
    document.getElementById("settings-email").textContent = email;
    document.getElementById("settings-budget").value = userBudget;
    
    updateUI(); 
  });

  // 2. Sync Expenses instantly
  const expQ = query(collection(db, "expenses"), where("uid", "==", currentUser.uid));
  unsubExpenses = onSnapshot(expQ, (snap) => {
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    expenses.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    
    updateUI();
  });
}

function stopRealtimeSync() {
  if (unsubUser) unsubUser();
  if (unsubExpenses) unsubExpenses();
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("auth-screen").classList.remove("active");
    document.getElementById("app-screen").classList.add("active");
    
    setGreeting();
    switchView("dashboard");
    startRealtimeSync(); // Turns on true real-time syncing
  } else {
    currentUser = null;
    stopRealtimeSync();
    document.getElementById("auth-screen").classList.add("active");
    document.getElementById("app-screen").classList.remove("active");
  }
});

// =====================
// NAVIGATION
// =====================
function switchView(viewName) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("view-" + viewName)?.classList.add("active");
  document.querySelector(`[data-view="${viewName}"]`)?.classList.add("active");

  if (viewName === "dashboard") renderDashboard();
  if (viewName === "summary") renderSummary();
  if (viewName === "splits") renderSplits();
}

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    switchView(item.dataset.view);
    closeSidebar();
  });
});

document.getElementById("btn-add-expense").addEventListener("click", () => openAddForm());
document.getElementById("btn-add-mobile").addEventListener("click", () => { openAddForm(); closeSidebar(); });

function openAddForm(expense = null) {
  editingExpenseId = expense?.id || null;
  document.getElementById("form-title").textContent = expense ? "Edit Expense" : "Add Expense";
  document.getElementById("edit-expense-id").value = expense?.id || "";
  document.getElementById("exp-category").value = expense?.category || "";
  document.getElementById("exp-amount").value = expense?.amount || "";
  document.getElementById("exp-date").value = expense?.date || todayStr();
  document.getElementById("exp-description").value = expense?.description || "";
  document.getElementById("form-error").textContent = "";

  const splitToggle = document.getElementById("split-toggle");
  splitToggle.checked = expense?.isSplit || false;
  document.getElementById("split-options").classList.toggle("hidden", !splitToggle.checked);
  
  document.getElementById("group-members-list").innerHTML = "";
  document.getElementById("payer-name").value = "";
  document.getElementById("my-share").value = "";
  document.getElementById("split-summary-group").classList.remove('visible');

  if (expense?.isSplit) {
    document.querySelector(`input[name="split-type"][value="${expense.splitType}"]`).checked = true;
    updateSplitTypeUI();
    if (expense.splitType === 'paid_for_group') {
      expense.splitMembers.forEach(m => addMemberRow(m.name, m.amount, m.id));
    } else {
      document.getElementById("payer-name").value = expense.payerName || "";
      document.getElementById("my-share").value = expense.myShare || "";
    }
  } else {
    document.querySelector(`input[name="split-type"][value="paid_for_group"]`).checked = true;
    updateSplitTypeUI();
    addMemberRow();
  }
  switchView("add-expense");
}

// =====================
// HAMBURGER
// =====================
document.getElementById("hamburger").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebar-overlay").classList.toggle("active");
});
document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("active");
}

// =====================
// SPLIT UI LOGIC
// =====================
const splitToggle = document.getElementById("split-toggle");
const splitOptions = document.getElementById("split-options");
const splitTypeRadios = document.querySelectorAll('input[name="split-type"]');
const paidForGroupSection = document.getElementById("paid-for-group-section");
const someonePaidSection = document.getElementById("someone-paid-section");
const groupMembersList = document.getElementById("group-members-list");

splitToggle.addEventListener('change', () => splitOptions.classList.toggle('hidden', !splitToggle.checked));
splitTypeRadios.forEach(r => r.addEventListener('change', updateSplitTypeUI));

function updateSplitTypeUI() {
  const type = document.querySelector('input[name="split-type"]:checked').value;
  if (type === 'paid_for_group') {
    paidForGroupSection.classList.remove('hidden');
    someonePaidSection.classList.add('hidden');
  } else {
    paidForGroupSection.classList.add('hidden');
    someonePaidSection.classList.remove('hidden');
  }
}

document.getElementById("add-member-btn").addEventListener('click', () => addMemberRow());

function addMemberRow(name = '', amount = '', id = Date.now().toString()) {
  const div = document.createElement('div');
  div.className = 'member-row';
  div.dataset.id = id;
  div.innerHTML = `
    <input type="text" class="m-name" placeholder="Name" value="${name}" />
    <div class="member-sep"></div>
    <input type="number" class="m-amount member-amount" placeholder="₹0" value="${amount}" min="0" />
    <button type="button" class="member-remove" title="Remove">✕</button>
  `;
  div.querySelector('.member-remove').addEventListener('click', () => { div.remove(); updateSplitSummary(); });
  groupMembersList.appendChild(div);
}

groupMembersList.addEventListener('input', updateSplitSummary);
function updateSplitSummary() {
  const rows = groupMembersList.querySelectorAll('.member-row');
  let sum = 0;
  rows.forEach(r => sum += (parseFloat(r.querySelector('.m-amount').value) || 0));
  const summary = document.getElementById('split-summary-group');
  if (sum > 0) {
    summary.classList.add('visible');
    summary.textContent = `Others owe you: ${fmt(sum)}. Your budget hit will be adjusted on save.`;
  } else {
    summary.classList.remove('visible');
  }
}

// =====================
// SAVE EXPENSE
// =====================
document.getElementById("save-expense-btn").addEventListener("click", async () => {
  const category = document.getElementById("exp-category").value;
  const amount = parseFloat(document.getElementById("exp-amount").value);
  const date = document.getElementById("exp-date").value;
  const description = document.getElementById("exp-description").value.trim();
  const err = document.getElementById("form-error");

  if (!category) { err.textContent = "Please select a category."; return; }
  if (!amount || amount <= 0) { err.textContent = "Please enter a valid amount."; return; }
  if (!date) { err.textContent = "Please select a date."; return; }

  let isSplit = splitToggle.checked;
  let splitType = null, splitMembers = [], payerName = '', myShare = 0;
  let effectiveAmount = amount; 

  if (isSplit) {
    splitType = document.querySelector('input[name="split-type"]:checked').value;
    if (splitType === 'paid_for_group') {
      const rows = groupMembersList.querySelectorAll('.member-row');
      let sumDues = 0;
      for (const row of rows) {
        const n = row.querySelector('.m-name').value.trim();
        const a = parseFloat(row.querySelector('.m-amount').value) || 0;
        if (n && a > 0) {
          splitMembers.push({ id: row.dataset.id, name: n, amount: a, settled: false });
          sumDues += a;
        }
      }
      if (splitMembers.length === 0) { err.textContent = "Add at least one person to split."; return; }
      effectiveAmount = amount - sumDues;
      if (effectiveAmount < 0) { err.textContent = "Split amounts exceed total expense."; return; }
    } else {
      payerName = document.getElementById("payer-name").value.trim();
      myShare = parseFloat(document.getElementById("my-share").value) || 0;
      if (!payerName) { err.textContent = "Enter who paid."; return; }
      if (myShare < 0) { err.textContent = "Enter your share."; return; }
      effectiveAmount = myShare;
    }
  }

  err.textContent = "";
  const saveBtn = document.getElementById("save-expense-btn");
  saveBtn.textContent = "Saving..."; saveBtn.disabled = true;

  try {
    const expenseData = {
      uid: currentUser.uid, category, amount, effectiveAmount, date, description,
      isSplit, splitType, splitMembers, payerName, myShare, settled: false,
      updatedAt: serverTimestamp()
    };

    if (editingExpenseId) {
      const oldExp = expenses.find(e => e.id === editingExpenseId);
      if (oldExp && oldExp.isSplit && isSplit) {
        if (splitType === 'paid_for_group' && oldExp.splitType === 'paid_for_group') {
          expenseData.splitMembers = splitMembers.map(newM => {
            const oldM = oldExp.splitMembers.find(m => m.id === newM.id);
            return oldM ? { ...newM, settled: oldM.settled } : newM;
          });
        } else if (splitType === 'someone_paid' && oldExp.splitType === 'someone_paid') {
          expenseData.settled = oldExp.settled;
        }
      }
      await updateDoc(doc(db, "expenses", editingExpenseId), expenseData);
      showToast("Expense updated ✓", "success");
    } else {
      expenseData.createdAt = serverTimestamp();
      await addDoc(collection(db, "expenses"), expenseData);
      showToast("Expense added ✓", "success");
    }

    // No need to manually load, onSnapshot handles it!
    switchView("dashboard");
  } catch (e) {
    err.textContent = "Error saving: " + e.message;
  } finally {
    saveBtn.innerHTML = `Save Expense`;
    saveBtn.disabled = false;
  }
});

document.getElementById("cancel-expense-btn").addEventListener("click", () => switchView("dashboard"));

// =====================
// UPDATE UI
// =====================
function updateUI() {
  renderDashboard();
  renderSplits();
}

// =====================
// RENDER DASHBOARD (ELEVATED BOXES)
// =====================
function renderDashboard() {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const today = todayStr();
  const filter = document.getElementById("category-filter").value;

  let filtered = expenses.filter(e => (e.date || "").startsWith(currentMonth));
  if (filter) filtered = filtered.filter(e => e.category === filter);

  const totalSpent = filtered.reduce((s, e) => s + getAmt(e), 0);
  const todaySpent = filtered.filter(e => e.date === today).reduce((s, e) => s + getAmt(e), 0);
  const remaining = userBudget - totalSpent;
  const pct = Math.min(100, Math.round((totalSpent / userBudget) * 100));

  document.getElementById("s-budget").textContent = fmt(userBudget);
  document.getElementById("s-spent").textContent = fmt(totalSpent);
  document.getElementById("s-remaining").textContent = fmt(remaining);
  document.getElementById("s-today").textContent = fmt(todaySpent);
  document.getElementById("budget-bar").style.width = pct + "%";
  document.getElementById("bp-percent").textContent = pct + "%";
  document.getElementById("s-remaining").style.color = remaining < 0 ? "var(--red)" : "var(--green)";

  const byDate = {};
  filtered.forEach(e => {
    const safeDate = e.date || todayStr();
    if (!byDate[safeDate]) byDate[safeDate] = [];
    byDate[safeDate].push(e);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const list = document.getElementById("expense-list");
  let empty = document.getElementById("empty-state");

  if (!empty) {
    empty = document.createElement("div");
    empty.id = "empty-state";
    empty.className = "empty-state";
    empty.innerHTML = `
      <div class="empty-icon">🧾</div>
      <h3>No expenses yet</h3>
      <p>Start tracking by adding your first expense</p>
      <button class="btn-primary sm" style="margin-top:1rem" onclick="document.getElementById('btn-add-expense').click()">+ Add Expense</button>
    `;
    list.appendChild(empty);
  }

  Array.from(list.children).forEach(child => {
    if (child.id !== "empty-state") {
      child.remove();
    }
  });

  if (dates.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  
  // Custom styled boxes per date
  list.insertAdjacentHTML("beforeend", dates.map(date => {
    const items = byDate[date];
    const dayTotal = items.reduce((s, e) => s + getAmt(e), 0);
    return `
      <div class="date-card" style="margin-bottom: 2rem; background: var(--bg2); border: 1px solid var(--border2); border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); overflow: hidden;">
        <div class="date-card-header" style="background: var(--bg3); padding: 1.2rem 1.5rem; border-bottom: 1px solid var(--border);">
          <div>
            <span class="date-label" style="font-size: 1rem; font-weight: 800;">${fmtDate(date)}</span>
            <span class="date-badge" style="margin-left:0.8rem; background: var(--bg4);">${items.length} item${items.length > 1 ? "s" : ""}</span>
          </div>
          <span class="date-total" style="font-size: 1.1rem;">${fmt(dayTotal)}</span>
        </div>
        <div class="expense-items" style="padding: 0.5rem 0;">
          ${items.map(e => renderExpenseItem(e)).join("")}
        </div>
      </div>
    `;
  }).join(""));

  list.querySelectorAll(".expense-item").forEach(el => {
    el.addEventListener("click", () => openModal(el.dataset.id));
  });
}

function renderExpenseItem(e) {
  const cat = CAT_CONFIG[e.category] || CAT_CONFIG.Other;
  let badgeHtml = '';
  
  if (e.isSplit) {
    if (e.splitType === 'paid_for_group') {
      const unsettledSum = e.splitMembers.filter(m => !m.settled).reduce((s, m) => s + m.amount, 0);
      if (unsettledSum > 0) badgeHtml = `<span class="exp-split-badge paid">Lent ${fmt(unsettledSum)}</span>`;
      else badgeHtml = `<span class="exp-split-badge">Settled</span>`;
    } else {
      if (!e.settled) badgeHtml = `<span class="exp-split-badge owe">Owe ${fmt(e.myShare)}</span>`;
      else badgeHtml = `<span class="exp-split-badge">Settled</span>`;
    }
  }

  return `
    <div class="expense-item" data-id="${e.id}" style="padding: 1rem 1.5rem;">
      <div class="exp-cat-icon ${cat.color}">${cat.icon}</div>
      <div class="exp-info">
        <div class="exp-cat" style="font-size: 0.95rem;">${e.category}</div>
        <div class="exp-desc">${e.description || "No description"}</div>
      </div>
      ${badgeHtml}
      <div class="exp-amount" style="font-size: 1.05rem;">${fmt(getAmt(e))}</div>
    </div>
  `;
}

// =====================
// CATEGORY FILTER
// =====================
document.getElementById("category-filter").addEventListener("change", (e) => {
  currentFilter = e.target.value;
  renderDashboard();
});

// =====================
// RENDER SPLITS
// =====================
function renderSplits() {
  const oweMeMap = {};
  const iOweMap = {};
  let totalOwedToMe = 0;
  let totalIOwe = 0;
  const history = [];

  expenses.forEach(e => {
    if (!e.isSplit) return;
    if (e.splitType === 'paid_for_group') {
      e.splitMembers.forEach(m => {
        if (!m.settled) {
          oweMeMap[m.name] = (oweMeMap[m.name] || 0) + m.amount;
          totalOwedToMe += m.amount;
        }
        history.push({
          id: e.id + '_' + m.id, type: 'credit', name: m.name, amount: m.amount, 
          date: e.date || todayStr(), settled: m.settled, desc: e.description || e.category
        });
      });
    } else if (e.splitType === 'someone_paid') {
      if (!e.settled && e.payerName) {
         iOweMap[e.payerName] = (iOweMap[e.payerName] || 0) + e.myShare;
         totalIOwe += e.myShare;
      }
      history.push({
        id: e.id, type: 'debt', name: e.payerName, amount: e.myShare, 
        date: e.date || todayStr(), settled: e.settled, desc: e.description || e.category
      });
    }
  });

  document.getElementById('total-owed-to-me').textContent = fmt(totalOwedToMe);
  document.getElementById('total-i-owe').textContent = fmt(totalIOwe);
  const net = totalOwedToMe - totalIOwe;
  const netEl = document.getElementById('net-position');
  
  netEl.textContent = fmt(Math.abs(net));
  if (net > 0) { netEl.className = 'split-kpi-value green'; netEl.textContent = '+' + fmt(net); }
  else if (net < 0) { netEl.className = 'split-kpi-value red'; netEl.textContent = '-' + fmt(Math.abs(net)); }
  else { netEl.className = 'split-kpi-value'; netEl.textContent = '₹0'; }

  const owedList = document.getElementById('owed-to-me-list');
  const oweKeys = Object.keys(oweMeMap);
  if (oweKeys.length === 0) owedList.innerHTML = '<div class="splits-empty">No pending dues</div>';
  else {
     owedList.innerHTML = oweKeys.map(name => `
        <div class="split-person-row">
          <div class="split-person-avatar">${name.charAt(0).toUpperCase()}</div>
          <div class="split-person-info">
            <div class="split-person-name">${name}</div>
            <div class="split-person-context">Owes you</div>
          </div>
          <div class="split-person-amount credit">${fmt(oweMeMap[name])}</div>
          <button class="btn-settle" data-name="${name}" data-type="owe_me" data-amount="${oweMeMap[name]}">Settle</button>
        </div>
     `).join('');
  }

  const iOweList = document.getElementById('i-owe-list');
  const iOweKeys = Object.keys(iOweMap);
  if (iOweKeys.length === 0) iOweList.innerHTML = `<div class="splits-empty">You're all settled up! 🎉</div>`;
  else {
     iOweList.innerHTML = iOweKeys.map(name => `
        <div class="split-person-row">
          <div class="split-person-avatar">${name.charAt(0).toUpperCase()}</div>
          <div class="split-person-info">
            <div class="split-person-name">${name}</div>
            <div class="split-person-context">You owe</div>
          </div>
          <div class="split-person-amount debt">${fmt(iOweMap[name])}</div>
          <button class="btn-settle" data-name="${name}" data-type="i_owe" data-amount="${iOweMap[name]}">Settle</button>
        </div>
     `).join('');
  }

  const histList = document.getElementById('splits-history-list');
  history.sort((a,b) => b.date.localeCompare(a.date));
  if (history.length === 0) histList.innerHTML = '<div class="splits-empty">No split history</div>';
  else {
     histList.innerHTML = history.map(h => `
        <div class="split-hist-item">
          <div class="split-hist-icon ${h.type}">${h.type === 'credit' ? '↓' : '↑'}</div>
          <div class="split-hist-info">
            <div class="split-hist-name">${h.name}</div>
            <div class="split-hist-meta">${fmtDate(h.date)} • ${h.desc}</div>
          </div>
          <div class="split-hist-amount ${h.type}">${fmt(h.amount)}</div>
          ${h.settled ? '<div class="split-settled-badge">Settled</div>' : ''}
        </div>
     `).join('');
  }

  const badgeCount = oweKeys.length + iOweKeys.length;
  const badge = document.getElementById('split-badge');
  if (badgeCount > 0) { badge.style.display = 'block'; badge.textContent = badgeCount; }
  else { badge.style.display = 'none'; }
}

document.getElementById('owed-to-me-list').addEventListener('click', e => {
  if (e.target.classList.contains('btn-settle')) {
      openSettleModal(e.target.dataset.name, e.target.dataset.type, e.target.dataset.amount);
  }
});
document.getElementById('i-owe-list').addEventListener('click', e => {
  if (e.target.classList.contains('btn-settle')) {
      openSettleModal(e.target.dataset.name, e.target.dataset.type, e.target.dataset.amount);
  }
});

// =====================
// SETTLE MODAL LOGIC
// =====================
function openSettleModal(name, type, amount) {
  settleTarget = { name, type };
  document.getElementById("settle-confirm-text").innerHTML = `Mark all dues with <strong>${name}</strong> (Total: ${fmt(amount)}) as settled?`;
  document.getElementById("settle-modal").classList.remove("hidden");
}

document.getElementById("settle-cancel-btn").addEventListener("click", () => document.getElementById("settle-modal").classList.add("hidden"));
document.getElementById("settle-modal-close").addEventListener("click", () => document.getElementById("settle-modal").classList.add("hidden"));

document.getElementById("settle-confirm-btn").addEventListener("click", async () => {
  if (!settleTarget) return;
  const btn = document.getElementById("settle-confirm-btn");
  btn.textContent = "Processing..."; btn.disabled = true;

  try {
      const promises = [];
      expenses.forEach(e => {
          if (e.isSplit && e.splitType === 'paid_for_group' && settleTarget.type === 'owe_me') {
              let updated = false;
              const newMembers = e.splitMembers.map(m => {
                  if (m.name === settleTarget.name && !m.settled) { updated = true; return { ...m, settled: true }; }
                  return m;
              });
              if (updated) promises.push(updateDoc(doc(db, "expenses", e.id), { splitMembers: newMembers }));
          }
          if (e.isSplit && e.splitType === 'someone_paid' && settleTarget.type === 'i_owe') {
              if (e.payerName === settleTarget.name && !e.settled) {
                  promises.push(updateDoc(doc(db, "expenses", e.id), { settled: true }));
              }
          }
      });
      await Promise.all(promises);
      showToast(`Settled with ${settleTarget.name} ✓`, "success");
      document.getElementById("settle-modal").classList.add("hidden");
  } catch (e) {
      showToast("Error settling dues", "error");
      console.error(e);
  } finally {
      btn.textContent = "Mark Settled ✓"; btn.disabled = false;
  }
});

// =====================
// EXPENSE MODAL
// =====================
function openModal(id) {
  const e = expenses.find(exp => exp.id === id);
  if (!e) return;
  const cat = CAT_CONFIG[e.category] || CAT_CONFIG.Other;
  document.getElementById("modal-title").textContent = `${cat.icon} ${e.category}`;

  let splitHtml = '';
  if (e.isSplit) {
      if (e.splitType === 'paid_for_group') {
          splitHtml = `<div class="modal-detail-row" style="margin-top:1rem;border-top:1px solid var(--border);padding-top:1rem"><span class="mdr-label" style="width:100%">Group Split: You Paid</span></div>`;
          e.splitMembers.forEach(m => {
              splitHtml += `<div class="modal-detail-row"><span class="mdr-label">${m.name}</span>
                <span class="mdr-value" style="color:${m.settled ? 'var(--green)' : 'var(--red)'}">${fmt(m.amount)} ${m.settled ? '(Settled)' : '(Owes you)'}</span></div>`;
          });
      } else {
          splitHtml = `<div class="modal-detail-row" style="margin-top:1rem;border-top:1px solid var(--border);padding-top:1rem"><span class="mdr-label" style="width:100%">Group Split: ${e.payerName} Paid</span></div>
            <div class="modal-detail-row"><span class="mdr-label">Your Share</span>
            <span class="mdr-value" style="color:${e.settled ? 'var(--green)' : 'var(--red)'}">${fmt(e.myShare)} ${e.settled ? '(Settled)' : '(You Owe)'}</span></div>`;
      }
  }

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-detail-row"><span class="mdr-label">Total Bill</span><span class="mdr-value" style="color:var(--accent);font-family:'JetBrains Mono',monospace;font-size:1.1rem">${fmt(e.amount)}</span></div>
    <div class="modal-detail-row"><span class="mdr-label">Budget Hit</span><span class="mdr-value" style="font-family:'JetBrains Mono',monospace;">${fmt(getAmt(e))}</span></div>
    <div class="modal-detail-row"><span class="mdr-label">Date</span><span class="mdr-value">${fmtDate(e.date)}</span></div>
    <div class="modal-detail-row"><span class="mdr-label">Category</span><span class="mdr-value">${e.category}</span></div>
    ${e.description ? `<div class="modal-detail-row"><span class="mdr-label">Desc</span><span class="mdr-value">${e.description}</span></div>` : ""}
    ${splitHtml}
  `;
  document.getElementById("modal-edit-btn").onclick = () => { document.getElementById("expense-modal").classList.add("hidden"); openAddForm(e); };
  document.getElementById("modal-delete-btn").onclick = () => { if (confirm("Delete this expense?")) deleteExpense(e.id); };
  document.getElementById("expense-modal").classList.remove("hidden");
}

async function deleteExpense(id) {
  try {
    await deleteDoc(doc(db, "expenses", id));
    showToast("Expense deleted", "default");
    document.getElementById("expense-modal").classList.add("hidden");
  } catch (e) {
    showToast("Error deleting expense", "error");
  }
}

document.getElementById("modal-close").addEventListener("click", () => document.getElementById("expense-modal").classList.add("hidden"));
document.getElementById("expense-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("expense-modal")) document.getElementById("expense-modal").classList.add("hidden");
});

// =====================
// MONTHLY SUMMARY
// =====================
function renderSummary() {
  const selector = document.getElementById("month-selector");
  const months = [...new Set(expenses.map(e => (e.date || "").slice(0, 7)))].filter(Boolean).sort((a, b) => b.localeCompare(a));
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (months.length === 0) months.push(currentMonth);

  selector.innerHTML = months.map(m => {
    const [y, mo] = m.split("-");
    const label = new Date(y, mo - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return `<option value="${m}" ${m === currentMonth ? "selected" : ""}>${label}</option>`;
  }).join("");

  const renderForMonth = (month) => {
    const monthExp = expenses.filter(e => (e.date || "").startsWith(month));
    const total = monthExp.reduce((s, e) => s + getAmt(e), 0);

    const catTotals = {};
    monthExp.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + getAmt(e); });
    const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    document.getElementById("category-breakdown").innerHTML = sortedCats.length === 0
      ? '<p style="color:var(--text2);font-size:0.9rem">No data for this month</p>'
      : sortedCats.map(([cat, amt]) => {
        const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
        const color = CAT_CONFIG[cat]?.barColor || "#8b949e";
        return `
          <div class="cat-row">
            <div class="cat-row-header">
              <span>${CAT_CONFIG[cat]?.icon || "📦"} ${cat}</span>
              <span>${fmt(amt)} <span style="color:var(--text3)">(${pct}%)</span></span>
            </div>
            <div class="cat-bar-bg">
              <div class="cat-bar" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>
        `;
      }).join("");

    const [y, mo] = month.split("-");
    const daysInMonth = new Date(y, mo, 0).getDate();
    const dailyTotals = {};
    monthExp.forEach(e => {
      const day = (e.date || "").slice(8);
      if(day) dailyTotals[day] = (dailyTotals[day] || 0) + getAmt(e);
    });
    const maxDaily = Math.max(...Object.values(dailyTotals), 1);
    const trendEl = document.getElementById("daily-trend");
    trendEl.innerHTML = Array.from({ length: daysInMonth }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      const amt = dailyTotals[d] || 0;
      const h = Math.max(4, Math.round((amt / maxDaily) * 90));
      return `
        <div class="trend-bar-wrap" title="${d}: ${fmt(amt)}">
          <div class="trend-bar" style="height:${h}px;opacity:${amt > 0 ? 0.9 : 0.15}"></div>
          <div class="trend-day">${i + 1}</div>
        </div>
      `;
    }).join("");

    const top = [...monthExp].sort((a, b) => getAmt(b) - getAmt(a)).slice(0, 5);
    document.getElementById("top-expenses-list").innerHTML = top.length === 0
      ? '<p style="color:var(--text2);font-size:0.9rem">No expenses</p>'
      : top.map((e, i) => `
        <div class="top-expense-row">
          <div class="te-rank">${i + 1}</div>
          <div class="te-info">
            <div class="te-cat">${CAT_CONFIG[e.category]?.icon} ${e.category}</div>
            <div class="te-date">${e.description || fmtDate(e.date)}</div>
          </div>
          <div class="te-amount">${fmt(getAmt(e))}</div>
        </div>
      `).join("");
  };

  renderForMonth(selector.value || currentMonth);
  selector.onchange = (e) => renderForMonth(e.target.value);
}

// =====================
// SETTINGS
// =====================
document.getElementById("save-budget-btn").addEventListener("click", async () => {
  const budget = parseFloat(document.getElementById("settings-budget").value);
  if (!budget || budget <= 0) { showToast("Enter a valid budget", "error"); return; }
  try {
    const q = query(collection(db, "users"), where("uid", "==", currentUser.uid));
    // Notice how we don't have a manual load or updateUI here anymore either!
    // The onSnapshot listener will detect this change and update the screen instantly.
    if (!unsubUser) { // safety check
      const snap = await getDocs(q);
      if (!snap.empty) { await updateDoc(doc(db, "users", snap.docs[0].id), { budget }); }
    } else {
       // get current doc id to update
       const snap = await getDocs(q);
       if(!snap.empty) await updateDoc(doc(db, "users", snap.docs[0].id), { budget });
    }
    showToast("Budget saved ✓", "success");
  } catch (e) {
    showToast("Error saving budget", "error");
  }
});

// =====================
// INIT
// =====================
document.getElementById("exp-date").value = todayStr();
