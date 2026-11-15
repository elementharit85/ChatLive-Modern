/* nex-invite.js — NexChat: undangan game di live chat jadi tombol "Gabung".
   Pasang di file chat, tepat sebelum </body> (setelah script utama):
   <script src="nex-invite.js"></script> */
(function () {
  const GAMES = { race: 'gamerace.html', billiard: 'gamebilliard.html', tictactoe: 'gametictactoe.html' };           // tambah game online lain di sini
  const re = /nexgame:(\w+):(\w+)/;

  const origMsgs = window.renderMessagesList;
  window.renderMessagesList = function () {
    origMsgs();
    const box = document.getElementById('messagesContainer'); if (!box) return;
    box.querySelectorAll('p').forEach(p => {
      const m = p.textContent.match(re); if (!m || !GAMES[m[1]]) return;
      p.textContent = p.textContent.replace(re, '').replace(/\s*·\s*$/, '').trim();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mt-2 block w-full px-3 py-2 rounded-lg bg-slate-950 text-emerald-300 font-bold text-xs hover:bg-slate-900 cursor-pointer';
      b.textContent = ({ billiard: '🎱 Gabung meja #', tictactoe: '❌⭕ Gabung ruang #' }[m[1]] || '🏁 Gabung ruang #') + m[2];
      b.onclick = () => { location.href = GAMES[m[1]] + '?room=' + encodeURIComponent(m[2]); };
      p.appendChild(b);
    });
  };

  const origList = window.renderContactList;          // pratinjau kontak: sembunyikan kode mentah
  window.renderContactList = function () {
    origList();
    document.querySelectorAll('#contactListContainer p').forEach(p => { if (re.test(p.textContent)) p.textContent = '🏁 Undangan game'; });
  };
})();
