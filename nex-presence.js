/* nex-presence.js — NexChat: otomatis Offline setelah 10 menit + "Terakhir online"
   Pasang satu baris ini di file chat, tepat sebelum </body>:
   <script src="nex-presence.js"></script>
   (Harus setelah <script> utama chat, karena memakai fungsi & variabel miliknya.) */
(function () {
  const AWAY_LIMIT_MS = 10 * 60 * 1000; // ubah ke 20 * 1000 untuk uji coba cepat
  let lastActivityAt = Date.now(), lastWritten = 0, auto = false, timers = [], refreshT = null;
  const presenceSeen = new Set(), leftNotified = new Set();

  const myMode = () => currentUser?.presence_mode || 'online';
  const inCall = () => !!peerConnection || !!callPartnerPhone;

  /* ---------- teks "terakhir online" ---------- */
  function formatLastSeen(iso, short) {
    if (!iso) return 'Offline';
    const d = new Date(iso); if (isNaN(d)) return 'Offline';
    const t = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    const day = d.toDateString() === now.toDateString() ? ''
      : d.toDateString() === y.toDateString() ? 'kemarin '
      : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ' ';
    return (short ? 'Terakhir online ' : 'Offline · terakhir online ') + day + t;
  }

  /* ---------- status efektif kontak ---------- */
  window.getContactEffectiveStatus = function (p) {
    const mode = presenceModesMap.get(p);
    if (mode === 'hidden') return 'offline';
    if (onlineUsersSet.has(p)) { presenceSeen.add(p); leftNotified.delete(p); return mode === 'busy' ? 'busy' : 'online'; }
    if (presenceSeen.has(p)) {            // tadi online, sekarang hilang dari presence
      if (!leftNotified.has(p)) { leftNotified.add(p); scheduleRefresh(); }
      return 'offline';
    }
    const c = contactsMap.get(p);
    if (!c || !c.is_online || c.presence_mode === 'hidden') return 'offline';
    if (c.last_seen && Date.now() - new Date(c.last_seen).getTime() > AWAY_LIMIT_MS) return 'offline';
    return c.presence_mode === 'busy' ? 'busy' : 'online';
  };

  /* ---------- presence milik sendiri ---------- */
  window.syncMyPresenceState = async function () {
    if (!globalChannel || !currentUser) return;
    const mode = myMode(), off = auto || mode === 'hidden';
    try {
      if (off) await globalChannel.untrack();
      else await globalChannel.track({ phone_4: currentUser.phone_4, display_name: currentUser.display_name, avatar_url: currentUser.avatar_url, presence_mode: mode, online_at: new Date().toISOString() });
    } catch (e) {}
    globalChannel.send({ type: 'broadcast', event: 'user_status_updated', payload: {
      phone_4: currentUser.phone_4, display_name: currentUser.display_name, avatar_url: currentUser.avatar_url,
      presence_mode: auto ? 'hidden' : mode, is_online: !off } });
  };

  async function heartbeat() {
    if (!currentUser || !dbTablesReady || auto || myMode() === 'hidden' || lastWritten === lastActivityAt) return;
    lastWritten = lastActivityAt;
    try { await supabaseClient.from('chat_users').update({ is_online: true, last_seen: new Date(lastActivityAt).toISOString() }).eq('phone_4', currentUser.phone_4); } catch (e) {}
  }

  async function goAutoOffline() {
    if (!currentUser || auto || inCall() || myMode() === 'hidden') return;
    auto = true;
    const leftAt = new Date(lastActivityAt).toISOString();
    if (dbTablesReady) { try { await supabaseClient.from('chat_users').update({ is_online: false, last_seen: leftAt }).eq('phone_4', currentUser.phone_4); } catch (e) {} }
    await syncMyPresenceState();
    updateMyProfileUI();
    showToast('Tidak aktif 10 menit — status Anda otomatis Offline.', 'info');
  }

  async function comeBack() {
    if (!auto) return;
    auto = false; lastWritten = 0;
    updateMyProfileUI();
    await syncMyPresenceState();
    await heartbeat();
    showToast('Selamat datang kembali — status Anda Online lagi.', 'success');
  }

  function markActivity() { lastActivityAt = Date.now(); if (auto && currentUser) comeBack(); }

  function tick() {
    if (!currentUser) return;
    if (inCall()) lastActivityAt = Date.now();
    else if (!auto && Date.now() - lastActivityAt >= AWAY_LIMIT_MS) goAutoOffline();
    renderContactList();
  }

  /* ---------- sinkron status & last seen kontak dari database ---------- */
  async function refreshContacts() {
    if (!currentUser || !dbTablesReady || contactsMap.size === 0) return;
    try {
      const { data } = await supabaseClient.from('chat_users').select('phone_4,is_online,last_seen').in('phone_4', Array.from(contactsMap.keys()));
      (data || []).forEach(u => { const c = contactsMap.get(u.phone_4); if (c) { c.is_online = u.is_online; c.last_seen = u.last_seen; } });
      saveContactsToLocalCache(); renderContactList();
    } catch (e) {}
  }
  function scheduleRefresh() { clearTimeout(refreshT); refreshT = setTimeout(refreshContacts, 2500); }

  /* ---------- tampilan: daftar kontak, header chat, status sendiri ---------- */
  const origRender = window.renderContactList;
  window.renderContactList = function () {
    origRender();
    const box = document.getElementById('contactListContainer'); if (!box) return;
    box.querySelectorAll('[onclick^="selectContactRoom"]').forEach(row => {
      const m = row.getAttribute('onclick').match(/'(\d{4})'/), c = m && contactsMap.get(m[1]);
      if (!c || c.last_msg || getContactEffectiveStatus(c.phone_4) !== 'offline') return;
      const p = row.querySelector('p'); if (p) p.textContent = formatLastSeen(c.last_seen, true);
    });
  };
  const origHeader = window.updateActiveContactHeader;
  window.updateActiveContactHeader = function () {
    origHeader();
    const c = activeContactPhone && contactsMap.get(activeContactPhone);
    if (c && getContactEffectiveStatus(activeContactPhone) === 'offline') {
      const el = document.getElementById('activeContactStatusText'); if (el) el.textContent = formatLastSeen(c.last_seen);
    }
  };
  const origProfile = window.updateMyProfileUI;
  window.updateMyProfileUI = function () {
    origProfile();
    if (!auto) return;
    document.getElementById('myStatusBadgeDot').className = 'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-slate-500 ring-2 ring-slate-900';
    document.getElementById('myStatusSmallDot').className = 'w-1.5 h-1.5 rounded-full bg-slate-400';
    document.getElementById('myStatusTextLabel').textContent = 'Offline (tidak aktif)';
  };

  /* ---------- siklus hidup ---------- */
  function start() {
    stop(); lastActivityAt = Date.now(); lastWritten = 0;
    heartbeat(); refreshContacts();
    timers = [setInterval(tick, 30000), setInterval(heartbeat, 60000), setInterval(refreshContacts, 30000)];
  }
  function stop() { timers.forEach(clearInterval); timers = []; auto = false; }

  const origEnter = window.enterChatApplication;
  window.enterChatApplication = async function () { await origEnter(); start(); };
  const origLogout = window.handleLogout;
  window.handleLogout = async function () { stop(); await origLogout(); };

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click'].forEach(e => addEventListener(e, markActivity, { passive: true }));
  addEventListener('scroll', markActivity, { passive: true, capture: true });
  addEventListener('focus', markActivity);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { markActivity(); refreshContacts(); } });
  addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  addEventListener('pagehide', () => {   // tab ditutup / pindah halaman: tandai offline secepatnya
    if (!currentUser || !dbTablesReady) return;
    const body = myMode() === 'hidden' ? { is_online: false } : { is_online: false, last_seen: new Date(lastActivityAt).toISOString() };
    try {
      fetch(`${SUPABASE_URL}/rest/v1/chat_users?phone_4=eq.${encodeURIComponent(currentUser.phone_4)}`, {
        method: 'PATCH', keepalive: true,
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      });
    } catch (e) {}
  });

  /* ---------- catatan di Buku Petunjuk ---------- */
  const li = Array.from(document.querySelectorAll('#settingsTabGuide li')).find(x => x.textContent.includes('Sembunyikan'));
  if (li) {
    const n = document.createElement('li');
    n.innerHTML = '<b class="text-sky-300">Otomatis Offline:</b> tidak aktif atau meninggalkan halaman sekitar 10 menit membuat status Offline dan teman melihat waktu <i>terakhir online</i>. Kembali aktif, status Online lagi.';
    li.parentNode.insertBefore(n, li);
  }
})();
