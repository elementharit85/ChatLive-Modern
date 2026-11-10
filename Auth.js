/**
 * auth.js - Modul Manajemen Autentikasi & Profil Pengguna dengan Integrasi Supabase
 * Project: zyddldgtefrtwjgymbtk.supabase.co
 */

const SUPABASE_URL = "https://zyddldgtefrtwjgymbtk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hrVo6BmPk-4b8YQozWzn9g_4xJlLwa-";

// Inisialisasi Supabase Client
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const STORAGE_USERS_KEY = 'aerochat_registered_users';
const STORAGE_SESSION_KEY = 'aerochat_active_session';

// State Pengguna Aktif
let currentUser = null;
let currentAuthMode = 'login';
let tempAvatarBase64 = null;

// ================= FUNGSI HELPER PENYIMPANAN =================

function getAllRegisteredUsers() {
  try {
    const raw = localStorage.getItem(STORAGE_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveUserToDatabase(userObj) {
  const users = getAllRegisteredUsers();
  const index = users.findIndex(u => u.email.toLowerCase() === userObj.email.toLowerCase() || u.code === userObj.code);
  if (index !== -1) {
    users[index] = { ...users[index], ...userObj };
  } else {
    users.push(userObj);
  }
  localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(users));
}

// Helper query Supabase dengan timeout agar form tidak macet jika koneksi lambat/tabel belum dibuat
async function queryWithTimeout(promise, timeoutMs = 2500) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Supabase request timeout')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

// Generate 4-Digit Unik yang belum pernah dipakai
async function generateUnique4DigitCode() {
  let code = '';
  let exists = true;
  let attempts = 0;

  while (exists && attempts < 20) {
    attempts++;
    code = Math.floor(1000 + Math.random() * 9000).toString();

    // Periksa di Supabase jika terhubung (dengan proteksi timeout)
    if (supabase) {
      try {
        const { data } = await queryWithTimeout(
          supabase.from('profiles').select('code').eq('code', code).limit(1),
          1500
        );
        if (!data || data.length === 0) {
          exists = false;
          break;
        }
      } catch (err) {
        exists = false;
        break;
      }
    } else {
      const localUsers = getAllRegisteredUsers();
      exists = localUsers.some(u => String(u.code) === code);
    }
  }

  return code || Math.floor(1000 + Math.random() * 9000).toString();
}

// ================= TAMPILAN AUTENTIKASI =================

function switchAuthTab(mode) {
  currentAuthMode = mode;
  const tabLogin = document.getElementById('tabLoginBtn');
  const tabReg = document.getElementById('tabRegisterBtn');
  const nameField = document.getElementById('nameFieldGroup');
  const lockNotice = document.getElementById('codeLockNotice');
  const submitBtn = document.getElementById('authSubmitBtn');
  const authNameInput = document.getElementById('authNameInput');

  if (mode === 'login') {
    tabLogin.className = 'py-2.5 text-xs font-semibold rounded-lg transition-all text-white bg-blue-600 shadow-md';
    tabReg.className = 'py-2.5 text-xs font-medium text-slate-400 hover:text-white rounded-lg transition-all';
    nameField.classList.add('hidden');
    lockNotice.classList.add('hidden');
    if (authNameInput) authNameInput.removeAttribute('required');
    submitBtn.innerHTML = `<span>Masuk ke Akun</span><i class="fa-solid fa-arrow-right text-xs"></i>`;
  } else {
    tabReg.className = 'py-2.5 text-xs font-semibold rounded-lg transition-all text-white bg-blue-600 shadow-md';
    tabLogin.className = 'py-2.5 text-xs font-medium text-slate-400 hover:text-white rounded-lg transition-all';
    nameField.classList.remove('hidden');
    lockNotice.classList.remove('hidden');
    if (authNameInput) authNameInput.setAttribute('required', 'true');
    submitBtn.innerHTML = `<span>Daftar Akun Baru & Kunci ID 4-Digit</span><i class="fa-solid fa-key text-xs"></i>`;
  }
}

function togglePasswordVisibility() {
  const pwd = document.getElementById('authPasswordInput');
  const icon = document.getElementById('togglePasswordIcon');
  if (pwd.type === 'password') {
    pwd.type = 'text';
    icon.className = 'fa-regular fa-eye-slash text-xs';
  } else {
    pwd.type = 'password';
    icon.className = 'fa-regular fa-eye text-xs';
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('authEmailInput').value.trim();
  const password = document.getElementById('authPasswordInput').value.trim();
  const name = document.getElementById('authNameInput').value.trim();

  if (!email || !password) {
    showToast('Lengkapi email dan kata sandi!', 'error');
    return;
  }

  if (currentAuthMode === 'register' && !name) {
    showToast('Silakan isi nama lengkap Anda!', 'error');
    return;
  }

  const submitBtn = document.getElementById('authSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.classList.add('opacity-70');

  try {
    if (currentAuthMode === 'login') {
      let matchedUser = null;

      // Cek di Supabase lebih dulu
      if (supabase) {
        try {
          const { data, error } = await queryWithTimeout(
            supabase.from('profiles').select('*').eq('email', email).limit(1)
          );

          if (!error && data && data.length > 0) {
            if (data[0].password === password) {
              matchedUser = data[0];
            } else {
              showToast('Kata sandi salah!', 'error');
              return;
            }
          }
        } catch (e) {
          console.warn('Fallback ke penyimpanan lokal:', e);
        }
      }

      // Fallback ke penyimpanan lokal jika offline/tabel belum dibuat
      if (!matchedUser) {
        const localUsers = getAllRegisteredUsers();
        matchedUser = localUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!matchedUser) {
          showToast('Akun belum terdaftar. Silakan buat akun baru!', 'error');
          return;
        }
        if (matchedUser.password !== password) {
          showToast('Kata sandi salah!', 'error');
          return;
        }
      }

      currentUser = matchedUser;
      currentUser.status = 'online';

      // Update status online ke Supabase
      if (supabase) {
        supabase.from('profiles').update({ status: 'online' }).eq('code', currentUser.code).catch(() => {});
      }
      saveUserToDatabase(currentUser);

    } else {
      // MODE REGISTER
      if (supabase) {
        try {
          const { data } = await queryWithTimeout(
            supabase.from('profiles').select('id').eq('email', email).limit(1)
          );
          if (data && data.length > 0) {
            showToast('Email ini sudah terdaftar! Silakan masuk.', 'error');
            return;
          }
        } catch (e) {
          console.warn('Lewati cek Supabase karena belum ada tabel / timeout:', e);
        }
      }

      // Validasi lokal apakah email sudah pernah didaftarkan
      const localUsers = getAllRegisteredUsers();
      if (localUsers.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        showToast('Email sudah terdaftar secara lokal! Silakan login.', 'error');
        return;
      }

      const assignedCode = await generateUnique4DigitCode();
      const finalName = name || email.split('@')[0];

      currentUser = {
        id: 'usr_' + Date.now(),
        name: finalName,
        email: email,
        password: password,
        code: assignedCode,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${assignedCode}`,
        status: 'online',
        created_at: new Date().toISOString()
      };

      // Simpan ke Supabase profiles (background)
      if (supabase) {
        queryWithTimeout(
          supabase.from('profiles').insert([currentUser]),
          2000
        ).catch(err => {
          console.warn("Gagal insert profil ke Supabase (gunakan fallback lokal):", err);
        });
      }

      saveUserToDatabase(currentUser);
      showToast(`Akun berhasil dibuat! Kode Unik Anda: #${currentUser.code}`, 'success');
    }

    // Simpan sesi aktif dan buka UI Chat
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(currentUser));
    bootApplicationUI();

  } catch (err) {
    console.error("Auth error:", err);
    showToast('Terjadi kesalahan saat memproses akun. Coba lagi.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-70');
  }
}

async function logoutCurrentUser() {
  if (currentUser) {
    currentUser.status = 'offline';
    if (supabase) {
      await supabase.from('profiles').update({ status: 'offline' }).eq('code', currentUser.code).catch(() => {});
    }
    saveUserToDatabase(currentUser);
  }
  localStorage.removeItem(STORAGE_SESSION_KEY);
  currentUser = null;
  document.getElementById('authScreen').classList.remove('hidden');
  showToast('Berhasil keluar dari akun.', 'info');
}

// ================= MANAJEMEN EDIT PROFIL =================

function openEditProfileModal() {
  if (!currentUser) return;
  document.getElementById('editNameInput').value = currentUser.name;
  document.getElementById('editAvatarPreview').src = currentUser.avatar;
  document.getElementById('editCodeView').textContent = currentUser.code;
  tempAvatarBase64 = null;
  document.getElementById('editProfileModal').classList.remove('hidden');
}

function closeEditProfileModal() {
  document.getElementById('editProfileModal').classList.add('hidden');
}

function onProfileAvatarPicked(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Hanya format gambar yang diperbolehkan!', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    tempAvatarBase64 = evt.target.result;
    document.getElementById('editAvatarPreview').src = tempAvatarBase64;
  };
  reader.readAsDataURL(file);
}

async function saveUserProfileChanges() {
  const newName = document.getElementById('editNameInput').value.trim();
  if (!newName) {
    showToast('Nama tidak boleh kosong!', 'error');
    return;
  }

  currentUser.name = newName;
  if (tempAvatarBase64) {
    currentUser.avatar = tempAvatarBase64;
  }

  // Simpan ke Supabase jika ada
  if (supabase) {
    try {
      await supabase.from('profiles').update({
        name: currentUser.name,
        avatar: currentUser.avatar,
        updated_at: new Date().toISOString()
      }).eq('code', currentUser.code);
    } catch (err) {
      console.warn("Gagal update profil ke Supabase:", err);
    }
  }

  // Simpan data pembaruan lokal
  saveUserToDatabase(currentUser);
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(currentUser));

  // Update UI Sidebar
  document.getElementById('myDisplayName').textContent = currentUser.name;
  document.getElementById('myAvatar').src = currentUser.avatar;

  closeEditProfileModal();
  showToast('Profil berhasil diperbarui!', 'success');

  // Trigger event sinkronisasi lokal
  window.dispatchEvent(new Event('storage'));
}

function copyMyCode() {
  if (!currentUser) return;
  const temp = document.createElement('input');
  temp.value = currentUser.code;
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    showToast(`Kode #${currentUser.code} disalin ke clipboard!`, 'success');
  } catch (err) {
    showToast(`Kode Anda: #${currentUser.code}`, 'info');
  }
  document.body.removeChild(temp);
}

// Modal SQL
function openSqlModal() {
  document.getElementById('sqlModal').classList.remove('hidden');
}

function closeSqlModal() {
  document.getElementById('sqlModal').classList.add('hidden');
}

function copySqlCode() {
  const code = document.getElementById('sqlSnippet').innerText;
  const temp = document.createElement('textarea');
  temp.value = code;
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    showToast('Kode skema SQL disalin ke clipboard!', 'success');
  } catch (err) {
    showToast('Silakan salin teks SQL secara manual.', 'info');
  }
  document.body.removeChild(temp);
}

// Inisialisasi awal saat halaman dimuat
window.addEventListener('DOMContentLoaded', () => {
  const savedSession = localStorage.getItem(STORAGE_SESSION_KEY);
  if (savedSession) {
    try {
      currentUser = JSON.parse(savedSession);
      bootApplicationUI();
    } catch (e) {
      document.getElementById('authScreen').classList.remove('hidden');
    }
  } else {
    document.getElementById('authScreen').classList.remove('hidden');
  }
});

function bootApplicationUI() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('myDisplayName').textContent = currentUser.name;
  document.getElementById('myFriendCode').textContent = currentUser.code;
  document.getElementById('myAvatar').src = currentUser.avatar;

  if (typeof initChatModule === 'function') {
    initChatModule();
  }
}

// ================= TOAST SYSTEM =================
let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  const msgElem = document.getElementById('toastMessage');
  const iconElem = document.getElementById('toastIcon');

  clearTimeout(toastTimer);
  msgElem.textContent = message;

  if (type === 'success') {
    iconElem.className = 'w-8 h-8 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center shrink-0';
    iconElem.innerHTML = '<i class="fa-solid fa-check text-xs"></i>';
  } else if (type === 'error') {
    iconElem.className = 'w-8 h-8 rounded-full bg-red-600/20 text-red-400 flex items-center justify-center shrink-0';
    iconElem.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-xs"></i>';
  } else {
    iconElem.className = 'w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0';
    iconElem.innerHTML = '<i class="fa-solid fa-info text-xs"></i>';
  }

  toast.classList.remove('translate-y-[-120%]', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  toastTimer = setTimeout(() => {
    toast.classList.add('translate-y-[-120%]', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3200);
}