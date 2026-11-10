/**
 * chat.js - Modul Live Chat Murni & Panggilan Siswa via Supabase Realtime
 * - Murni interaksi akun mahasiswa nyata (tanpa bot)
 * - Sinkronisasi pesan live & foto via Supabase Realtime
 * - Tambah kontak via kode 4-digit langsung dari database profiles
 * - WebRTC Voice & Video Call Signaling via Supabase Broadcast
 */

let myContacts = [];
let activeContact = null;
let currentPhotoBase64 = null;
let realtimeSubscription = null;
let realtimeBroadcastChannel = null;

// Panggilan (WebRTC)
let activeCallType = null;
let callMediaStream = null;
let isAudioMuted = false;
let isCameraDisabled = false;

// ================= INIT & PENYIMPANAN =================

async function initChatModule() {
  loadMyContacts();
  renderContacts();

  if (myContacts.length > 0) {
    openChatWithContact(myContacts[0].id);
  } else {
    showEmptyPlaceholder();
  }

  setupSupabaseRealtime();
}

function getContactsStorageKey() {
  return `aerochat_contacts_${currentUser.code}`;
}

function loadMyContacts() {
  if (!currentUser) return;
  const raw = localStorage.getItem(getContactsStorageKey());
  myContacts = raw ? JSON.parse(raw) : [];

  // Sinkronkan data dari profile Supabase bila tersedia
  syncContactsFromSupabase();
}

async function syncContactsFromSupabase() {
  if (!supabase || myContacts.length === 0) return;
  const codes = myContacts.map(c => c.code);

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('code, name, avatar, status')
      .in('code', codes);

    if (!error && data) {
      data.forEach(u => {
        const c = myContacts.find(x => x.code === u.code);
        if (c) {
          c.name = u.name;
          c.avatar = u.avatar;
          c.online = u.status === 'online';
        }
      });
      saveMyContacts();
      renderContacts();
    }
  } catch (err) {
    console.warn("Gagal menyinkronkan status kontak dari Supabase:", err);
  }
}

function saveMyContacts() {
  if (!currentUser) return;
  localStorage.setItem(getContactsStorageKey(), JSON.stringify(myContacts));
}

function showEmptyPlaceholder() {
  activeContact = null;
  document.getElementById('emptyChatPlaceholder').classList.remove('hidden');
  document.getElementById('activeChatWindow').classList.add('hidden');
}

// ================= RENDER DAFTAR KONTAK =================

function renderContacts(query = '') {
  const container = document.getElementById('contactsContainer');
  if (!container) return;

  const filtered = myContacts.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.code.includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 text-xs">
        <i class="fa-solid fa-user-group text-2xl mb-2 opacity-40 block"></i>
        Belum ada teman sekelas.<br/>
        Klik ikon <strong class="text-blue-400">+</strong> untuk memasukkan 4-digit teman.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const isActive = activeContact && activeContact.id === c.id;
    const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
    let preview = 'Belum ada obrolan';
    if (lastMsg) {
      preview = lastMsg.type === 'photo' 
        ? '<i class="fa-regular fa-image text-blue-400 mr-1"></i> Foto' 
        : escapeMarkup(lastMsg.text);
    }

    return `
      <div onclick="openChatWithContact('${c.id}')" class="flex items-center gap-3 p-3.5 cursor-pointer transition-all ${
        isActive ? 'bg-[#192854] border-l-4 border-blue-500' : 'hover:bg-[#142048]/60'
      }">
        <div class="relative shrink-0">
          <img src="${c.avatar}" alt="${escapeMarkup(c.name)}" class="w-10 h-10 rounded-full object-cover border border-slate-700" />
          <span class="absolute bottom-0 right-0 w-3 h-3 ${c.online ? 'bg-emerald-500' : 'bg-slate-500'} border-2 border-[#0e1738] rounded-full"></span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-xs font-semibold text-white truncate max-w-[130px]">${escapeMarkup(c.name)}</span>
            <span class="text-[10px] text-slate-400 font-mono">${lastMsg ? lastMsg.time : ''}</span>
          </div>
          <div class="flex items-center justify-between">
            <p class="text-xs text-slate-400 truncate pr-2">${preview}</p>
            <div class="flex items-center gap-1">
              <span class="text-[10px] font-mono text-blue-300 bg-blue-950/80 px-1.5 py-0.2 rounded border border-blue-500/20">#${c.code}</span>
              ${c.unread > 0 ? `<span class="bg-blue-600 text-white text-[10px] font-bold px-1.5 rounded-full">${c.unread}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function handleFriendSearch(val) {
  renderContacts(val);
}

// ================= MEMILIH DAN MEMBUKA CHAT =================

function openChatWithContact(contactId) {
  const contact = myContacts.find(c => c.id === contactId);
  if (!contact) return;

  activeContact = contact;
  activeContact.unread = 0;
  saveMyContacts();

  document.getElementById('emptyChatPlaceholder').classList.add('hidden');
  document.getElementById('activeChatWindow').classList.remove('hidden');

  // Set Header Chat
  document.getElementById('activeContactName').textContent = contact.name;
  document.getElementById('activeContactAvatar').src = contact.avatar;
  document.getElementById('activeContactCodeTag').textContent = `#${contact.code}`;
  
  const statusLabel = document.getElementById('activeContactStatusLabel');
  const statusDot = document.getElementById('activeContactOnlineDot');
  if (contact.online) {
    statusLabel.textContent = 'Online';
    statusLabel.className = 'text-[11px] text-emerald-400 font-medium';
    statusDot.className = 'absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#0f193f] rounded-full';
  } else {
    statusLabel.textContent = 'Offline';
    statusLabel.className = 'text-[11px] text-slate-400 font-medium';
    statusDot.className = 'absolute bottom-0 right-0 w-3 h-3 bg-slate-500 border-2 border-[#0f193f] rounded-full';
  }

  // Tampilan Mobile
  if (window.innerWidth < 768) {
    document.getElementById('chatSidebar').classList.add('hidden');
  }

  renderMessages();
  renderContacts();
  cancelPhotoSelection();
}

function backToSidebarMobile() {
  document.getElementById('chatSidebar').classList.remove('hidden');
}

// ================= RENDER PESAN =================

function renderMessages() {
  const list = document.getElementById('messagesList');
  if (!list || !activeContact) return;

  if (!activeContact.messages || activeContact.messages.length === 0) {
    list.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
        <div class="w-14 h-14 rounded-2xl bg-blue-950/60 flex items-center justify-center text-blue-400 text-xl mb-3 border border-blue-500/20">
          <i class="fa-regular fa-comment-dots"></i>
        </div>
        <p class="text-xs font-semibold text-slate-300">Mulai percakapan live</p>
        <p class="text-[11px] text-slate-400 mt-1 max-w-xs">Kirim pesan teks atau foto langsung ke teman kelas Anda.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = activeContact.messages.map(msg => {
    const isMe = msg.sender === 'me';
    return `
      <div class="flex ${isMe ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[80%] sm:max-w-[65%] rounded-2xl p-3 shadow-md ${
          isMe 
            ? 'bg-blue-600 text-white rounded-tr-none' 
            : 'bg-[#18254c] text-slate-100 rounded-tl-none border border-slate-700/50'
        }">
          ${msg.type === 'photo' && msg.photoUrl ? `
            <div class="mb-2 rounded-xl overflow-hidden border border-black/20">
              <img src="${msg.photoUrl}" alt="Foto" class="w-full max-h-64 object-cover cursor-pointer hover:scale-[1.01] transition" onclick="window.open('${msg.photoUrl}', '_blank')" />
            </div>
          ` : ''}
          ${msg.text ? `<p class="text-xs leading-relaxed break-words whitespace-pre-wrap">${escapeMarkup(msg.text)}</p>` : ''}
          <div class="flex items-center justify-end gap-1 mt-1 text-[10px] ${isMe ? 'text-blue-200' : 'text-slate-400'}">
            <span>${msg.time}</span>
            ${isMe ? `<i class="fa-solid fa-check-double text-[10px]"></i>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

// ================= PENGIRIMAN PESAN & FOTO =================

function getCurrentClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function onChatInputKeydown(e) {
  if (e.key === 'Enter') {
    dispatchCurrentMessage();
  }
}

function onPhotoPicked(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Hanya gambar/foto yang diperbolehkan! Video tidak didukung.', 'error');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    currentPhotoBase64 = evt.target.result;
    document.getElementById('photoPreviewImg').src = currentPhotoBase64;
    document.getElementById('photoPreviewBar').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function cancelPhotoSelection() {
  currentPhotoBase64 = null;
  const input = document.getElementById('chatPhotoInput');
  if (input) input.value = '';
  document.getElementById('photoPreviewBar').classList.add('hidden');
}

async function dispatchCurrentMessage() {
  if (!activeContact) {
    showToast('Pilih kontak terlebih dahulu!', 'error');
    return;
  }

  const textInput = document.getElementById('chatTextInput');
  const text = textInput.value.trim();

  if (!text && !currentPhotoBase64) return;

  const newMsg = {
    sender: 'me',
    type: currentPhotoBase64 ? 'photo' : 'text',
    text: text,
    photoUrl: currentPhotoBase64 || null,
    time: getCurrentClock()
  };

  if (!activeContact.messages) activeContact.messages = [];
  activeContact.messages.push(newMsg);
  saveMyContacts();

  // 1. Kirim via Supabase Database (Realtime Sync ke perangkat lain)
  if (supabase) {
    try {
      await supabase.from('messages').insert([{
        sender_code: currentUser.code,
        receiver_code: activeContact.code,
        type: newMsg.type,
        text: newMsg.text,
        photo_url: newMsg.photoUrl,
        time: newMsg.time
      }]);
    } catch (err) {
      console.warn("Kirim pesan ke Supabase gagal, fallback lokal:", err);
    }
  }

  // 2. Kirim secara persisten ke penerima di LocalStorage (multi-tab lokal)
  transferMessageToRecipient(currentUser.code, activeContact.code, {
    type: newMsg.type,
    text: newMsg.text,
    photoUrl: newMsg.photoUrl,
    time: newMsg.time
  });

  textInput.value = '';
  cancelPhotoSelection();
  renderMessages();
  renderContacts();
}

function transferMessageToRecipient(senderCode, targetCode, messagePayload) {
  try {
    const recipientKey = `aerochat_contacts_${targetCode}`;
    const raw = localStorage.getItem(recipientKey);
    let recipientContacts = raw ? JSON.parse(raw) : [];

    let contactEntry = recipientContacts.find(c => c.code === senderCode);
    if (!contactEntry) {
      contactEntry = {
        id: 'c_' + Date.now(),
        name: currentUser.name,
        code: senderCode,
        avatar: currentUser.avatar,
        online: true,
        unread: 1,
        messages: []
      };
      recipientContacts.unshift(contactEntry);
    } else {
      contactEntry.name = currentUser.name;
      contactEntry.avatar = currentUser.avatar;
      contactEntry.unread = (contactEntry.unread || 0) + 1;
    }

    contactEntry.messages.push({
      sender: 'them',
      type: messagePayload.type,
      text: messagePayload.text,
      photoUrl: messagePayload.photoUrl,
      time: messagePayload.time
    });

    localStorage.setItem(recipientKey, JSON.stringify(recipientContacts));

    // Kirim notifikasi sinkronisasi multi-tab
    localStorage.setItem('aerochat_live_ping', JSON.stringify({
      targetCode: targetCode,
      senderCode: senderCode,
      senderName: currentUser.name,
      timestamp: Date.now()
    }));
  } catch (err) {
    console.error("Gagal menyinkronkan ke penerima:", err);
  }
}

// ================= SUPABASE REALTIME SYNC =================

function setupSupabaseRealtime() {
  if (!supabase || !currentUser) return;

  try {
    // 1. Channel Realtime Postgres Changes untuk Pesan Masuk
    realtimeSubscription = supabase
      .channel('public:messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `receiver_code=eq.${currentUser.code}`
      }, (payload) => {
        handleIncomingRealtimeMessage(payload.new);
      })
      .subscribe();

    // 2. Channel Realtime Broadcast untuk Signaling Panggilan
    realtimeBroadcastChannel = supabase.channel(`call_room_${currentUser.code}`);
    realtimeBroadcastChannel
      .on('broadcast', { event: 'call_signal' }, (payload) => {
        handleIncomingCallSignal(payload.payload);
      })
      .subscribe();

  } catch (err) {
    console.warn("Gagal inisialisasi Supabase Realtime:", err);
  }
}

async function handleIncomingRealtimeMessage(row) {
  if (!row || row.sender_code === currentUser.code) return;

  let senderContact = myContacts.find(c => c.code === row.sender_code);

  if (!senderContact) {
    // Ambil info nama & avatar pengirim dari tabel profiles
    let senderName = `Teman #${row.sender_code}`;
    let senderAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${row.sender_code}`;

    if (supabase) {
      try {
        const { data } = await supabase.from('profiles').select('name, avatar').eq('code', row.sender_code).limit(1);
        if (data && data[0]) {
          senderName = data[0].name;
          senderAvatar = data[0].avatar;
        }
      } catch (e) {}
    }

    senderContact = {
      id: 'cnt_' + Date.now(),
      name: senderName,
      code: row.sender_code,
      avatar: senderAvatar,
      online: true,
      unread: 0,
      messages: []
    };
    myContacts.unshift(senderContact);
  }

  const incoming = {
    sender: 'them',
    type: row.type || 'text',
    text: row.text,
    photoUrl: row.photo_url,
    time: row.time || getCurrentClock()
  };

  if (!senderContact.messages) senderContact.messages = [];
  senderContact.messages.push(incoming);

  if (activeContact && activeContact.code === row.sender_code) {
    activeContact.messages = senderContact.messages;
    renderMessages();
  } else {
    senderContact.unread = (senderContact.unread || 0) + 1;
    showToast(`Pesan baru dari ${senderContact.name} (#${senderContact.code})`, 'info');
  }

  saveMyContacts();
  renderContacts();
}

// Sinkronisasi lokal antar tab
window.addEventListener('storage', (e) => {
  if (e.key === 'aerochat_live_ping' && e.newValue && currentUser) {
    try {
      const ping = JSON.parse(e.newValue);
      if (ping.targetCode === currentUser.code) {
        loadMyContacts();
        if (activeContact && activeContact.code === ping.senderCode) {
          const updated = myContacts.find(c => c.code === activeContact.code);
          if (updated) {
            activeContact.messages = updated.messages;
            activeContact.unread = 0;
            saveMyContacts();
          }
          renderMessages();
        } else {
          showToast(`Pesan baru dari ${ping.senderName} (#${ping.senderCode})`, 'info');
        }
        renderContacts();
      }
    } catch (err) {
      console.error(err);
    }
  }
});

// ================= TAMBAH TEMAN 4-DIGIT =================

function openAddFriendModal() {
  document.getElementById('targetFriendCode').value = '';
  document.getElementById('addFriendModal').classList.remove('hidden');
  document.getElementById('targetFriendCode').focus();
}

function closeAddFriendModal() {
  document.getElementById('addFriendModal').classList.add('hidden');
}

async function executeAddFriend() {
  const code = document.getElementById('targetFriendCode').value.trim();

  if (code.length !== 4 || isNaN(code)) {
    showToast('Kode harus berupa 4 digit angka!', 'error');
    return;
  }

  if (currentUser && code === currentUser.code) {
    showToast('Anda tidak dapat menambahkan kode ID Anda sendiri!', 'error');
    return;
  }

  // Cek apakah sudah ada di kontak
  const alreadyInList = myContacts.find(c => c.code === code);
  if (alreadyInList) {
    showToast(`Teman dengan kode #${code} sudah ada di kontak!`, 'info');
    openChatWithContact(alreadyInList.id);
    closeAddFriendModal();
    return;
  }

  let foundUser = null;

  // 1. Cari di Supabase Database
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('code', code)
        .limit(1);

      if (!error && data && data.length > 0) {
        foundUser = data[0];
      }
    } catch (err) {
      console.warn("Cek Supabase profiles error:", err);
    }
  }

  // 2. Fallback pencarian lokal
  if (!foundUser) {
    const allUsers = getAllRegisteredUsers();
    foundUser = allUsers.find(u => u.code === code);
  }

  if (!foundUser) {
    showToast(`Mahasiswa dengan kode #${code} tidak ditemukan di database!`, 'error');
    return;
  }

  const newFriend = {
    id: 'cnt_' + Date.now(),
    name: foundUser.name,
    code: foundUser.code,
    avatar: foundUser.avatar,
    online: foundUser.status === 'online',
    unread: 0,
    messages: []
  };

  myContacts.unshift(newFriend);
  saveMyContacts();
  openChatWithContact(newFriend.id);
  renderContacts();
  closeAddFriendModal();
  showToast(`Berhasil menambahkan ${newFriend.name}!`, 'success');
}

// ================= PANGGILAN SUARA & VIDEO (WEBRTC) =================

async function initiateCall(type) {
  if (!activeContact) {
    showToast('Pilih kontak teman terlebih dahulu!', 'error');
    return;
  }

  activeCallType = type;
  document.getElementById('callPeerName').textContent = activeContact.name;
  document.getElementById('callPeerAvatar').src = activeContact.avatar;
  document.getElementById('callStatusText').textContent = 'Menghubungkan...';

  const overlay = document.getElementById('callOverlay');
  const avatarArea = document.getElementById('callAvatarArea');
  const videoArea = document.getElementById('callVideoArea');
  const toggleCamBtn = document.getElementById('toggleCamBtn');
  const headerIcon = document.getElementById('callHeaderIcon');
  const headerType = document.getElementById('callHeaderType');

  if (type === 'video') {
    headerIcon.className = 'fa-solid fa-video';
    headerType.textContent = 'Panggilan Video';
    avatarArea.classList.add('hidden');
    videoArea.classList.remove('hidden');
    toggleCamBtn.classList.remove('hidden');
  } else {
    headerIcon.className = 'fa-solid fa-phone';
    headerType.textContent = 'Panggilan Suara';
    avatarArea.classList.remove('hidden');
    videoArea.classList.add('hidden');
    toggleCamBtn.classList.add('hidden');
  }

  overlay.classList.remove('hidden');

  try {
    const constraints = {
      audio: true,
      video: type === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false
    };

    callMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (type === 'video') {
      document.getElementById('localVideoStream').srcObject = callMediaStream;
      document.getElementById('remoteVideoStream').srcObject = callMediaStream;
    }

    document.getElementById('callStatusText').textContent = 'Panggilan Terhubung';

    // Broadcast sinyal call ke target via Supabase
    if (supabase) {
      const channel = supabase.channel(`call_room_${activeContact.code}`);
      await channel.subscribe();
      channel.send({
        type: 'broadcast',
        event: 'call_signal',
        payload: {
          callerName: currentUser.name,
          callerCode: currentUser.code,
          callType: type
        }
      });
    }

  } catch (err) {
    console.error("Izin perangkat ditolak:", err);
    showToast('Izin kamera/mikrofon tidak aktif atau perangkat tidak ditemukan.', 'error');
    endActiveCall();
  }
}

function handleIncomingCallSignal(signal) {
  if (!signal) return;
  showToast(`Panggilan ${signal.callType} masuk dari ${signal.callerName} (#${signal.callerCode})`, 'info');
}

function toggleAudioMute() {
  if (!callMediaStream) return;
  const audioTrack = callMediaStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    isAudioMuted = !audioTrack.enabled;
    const btn = document.getElementById('muteMicBtn');
    const icon = document.getElementById('muteMicIcon');
    if (isAudioMuted) {
      btn.className = 'w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center transition shadow-lg';
      icon.className = 'fa-solid fa-microphone-slash';
      showToast('Mikrofon nonaktif', 'info');
    } else {
      btn.className = 'w-12 h-12 rounded-full bg-slate-800 text-white flex items-center justify-center transition shadow-lg';
      icon.className = 'fa-solid fa-microphone';
      showToast('Mikrofon aktif', 'info');
    }
  }
}

function toggleCameraStream() {
  if (!callMediaStream) return;
  const videoTrack = callMediaStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    isCameraDisabled = !videoTrack.enabled;
    const btn = document.getElementById('toggleCamBtn');
    const icon = document.getElementById('toggleCamIcon');
    if (isCameraDisabled) {
      btn.className = 'w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center transition shadow-lg';
      icon.className = 'fa-solid fa-video-slash';
      showToast('Kamera nonaktif', 'info');
    } else {
      btn.className = 'w-12 h-12 rounded-full bg-slate-800 text-white flex items-center justify-center transition shadow-lg';
      icon.className = 'fa-solid fa-video';
      showToast('Kamera aktif', 'info');
    }
  }
}

function endActiveCall() {
  if (callMediaStream) {
    callMediaStream.getTracks().forEach(track => track.stop());
    callMediaStream = null;
  }
  const localVideo = document.getElementById('localVideoStream');
  const remoteVideo = document.getElementById('remoteVideoStream');
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;

  document.getElementById('callOverlay').classList.add('hidden');
  showToast('Panggilan selesai.', 'info');
}

// Helper sanitasi teks
function escapeMarkup(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}