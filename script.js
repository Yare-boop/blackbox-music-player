// ⚙️ CONFIGURACIÓN — cambia esta URL por la de tu backend en Render
// Encuéntrala en: render.com → tu servicio → la URL que termina en .onrender.com
const BACKEND_URL = '';

// ==================== BLACKBOX — script.js ====================
console.log('⚫ BlackBox iniciando...');

// ==================== DOM REFS ====================
const audio         = document.getElementById('audio-player');
const playPauseBtn  = document.getElementById('play-pause-btn');
const prevBtn       = document.getElementById('prev-btn');
const nextBtn       = document.getElementById('next-btn');
const shuffleBtn    = document.getElementById('shuffle-btn');
const repeatBtn     = document.getElementById('repeat-btn');
const progressBar   = document.getElementById('progress-bar');
const progressFill  = document.getElementById('progress-fill');
const currentTimeEl = document.getElementById('current-time');
const durationEl    = document.getElementById('duration');
const volumeCtrl    = document.getElementById('volume-control');
const songTitleEl   = document.getElementById('song-title');
const songArtistEl  = document.getElementById('song-artist');
const coverImg      = document.getElementById('cover-img');
const coverRing     = document.querySelector('.cover-ring');
const playlistEl    = document.getElementById('playlist');
const fileInput     = document.getElementById('file-input');
const storageUsedEl = document.getElementById('storage-used');
const songCountEl   = document.getElementById('song-count');
const searchInput   = document.getElementById('search-input');

// ==================== STATE ====================
let songs        = [];
let currentIndex = 0;
let db           = null;
let playlists    = [];
let isShuffled   = false;
let repeatMode   = 'none';
let shuffleQueue = [];
let searchQuery  = '';
let noteSongId   = null;

// ==================== UTILS ====================
function throttle(fn, ms) {
    let t; return (...a) => { if (!t) { fn(...a); t = setTimeout(()=>t=null, ms); } };
}

function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s/60), ss = Math.floor(s%60);
    return `${m}:${ss<10?'0':''}${ss}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function generateShuffleQueue() {
    shuffleQueue = [...songs.map((_,i)=>i)];
    for (let i = shuffleQueue.length-1; i>0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]];
    }
}

// ==================== INDEXEDDB ====================
function initDB() {
    return new Promise(resolve => {
        const req = indexedDB.open('BlackBoxDB', 2);
        req.onerror = () => { console.error('❌ DB error'); resolve(null); };
        req.onsuccess = e => { db = e.target.result; console.log('✅ DB lista'); resolve(db); };
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('songs'))
                db.createObjectStore('songs', { keyPath:'id', autoIncrement:true });
            if (!db.objectStoreNames.contains('audio'))
                db.createObjectStore('audio', { keyPath:'id' });
        };
    });
}

// ==================== COVER & LYRICS ====================
async function fetchAlbumCover(artist, title) {
    if (!artist || !title || ['Local','Web','YouTube'].includes(artist)) return null;
    try {
        const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist+' '+title)}&limit=1&entity=song`);
        const d = await r.json();
        if (d.results?.[0]?.artworkUrl100)
            return d.results[0].artworkUrl100.replace('100x100','600x600');
    } catch {}
    return null;
}

async function fetchLyrics(artist, title) {
    if (!artist || !title || ['Local','Web','YouTube'].includes(artist)) return null;
    try {
        const r = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (r.ok) { const d = await r.json(); if (d.lyrics?.length > 50) return d.lyrics; }
    } catch {}
    return null;
}

// ==================== SAVE / GET SONGS ====================
async function songExists(title, artist) {
    return new Promise(resolve => {
        const tx = db.transaction(['songs'],'readonly');
        tx.objectStore('songs').getAll().onsuccess = e => {
            const found = e.target.result.some(s =>
                s.title?.toLowerCase()===title?.toLowerCase() &&
                s.artist?.toLowerCase()===artist?.toLowerCase()
            );
            resolve(found);
        };
    });
}

async function saveSong(title, artist, blob, skipDuplicateCheck=false) {
    if (!skipDuplicateCheck) {
        const exists = await songExists(title, artist);
        if (exists) {
            console.log(`⏭ Omitida (ya existe): ${title}`);
            return { skipped: true };
        }
    }

    let mimeType = blob.type;
    if (!mimeType?.includes('audio')) mimeType = 'audio/mpeg';
    const correctedBlob = new Blob([blob], { type: mimeType });

    const coverUrl = await fetchAlbumCover(artist, title);
    const lyrics   = await fetchLyrics(artist, title);

    return new Promise((resolve, reject) => {
        const tx   = db.transaction(['songs','audio'],'readwrite');
        const songStore  = tx.objectStore('songs');
        const audioStore = tx.objectStore('audio');

        const req = songStore.add({
            title, artist,
            size: correctedBlob.size,
            mimeType,
            coverUrl,
            lyrics,
            note: '',
            date: new Date().toISOString()
        });

        req.onsuccess = e => {
            const id = e.target.result;
            audioStore.add({ id, blob: correctedBlob }).onsuccess = () => {
                console.log(`✅ Guardado: ${title}`);
                resolve({ skipped: false, id });
            };
            audioStore.onerror = reject;
        };
        req.onerror = reject;
    });
}

function getSongs() {
    return new Promise(resolve => {
        const tx = db.transaction(['songs'],'readonly');
        tx.objectStore('songs').getAll().onsuccess = e => resolve(e.target.result || []);
    });
}

function getAudioUrl(id) {
    return new Promise(resolve => {
        const tx = db.transaction(['audio'],'readonly');
        tx.objectStore('audio').get(id).onsuccess = e => {
            const r = e.target.result;
            resolve(r?.blob ? URL.createObjectURL(r.blob) : null);
        };
    });
}

function deleteSong(id) {
    return new Promise(resolve => {
        const tx = db.transaction(['songs','audio'],'readwrite');
        tx.objectStore('songs').delete(id);
        tx.objectStore('audio').delete(id);
        tx.oncomplete = resolve;
    });
}

function updateSongField(id, field, value) {
    return new Promise(resolve => {
        const tx    = db.transaction(['songs'],'readwrite');
        const store = tx.objectStore('songs');
        const req   = store.get(id);
        req.onsuccess = () => {
            const s = req.result;
            if (s) { s[field] = value; store.put(s); }
        };
        tx.oncomplete = resolve;
    });
}

// ==================== RENDER LIST ====================
function getFilteredSongs() {
    if (!searchQuery) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(s =>
        s.title?.toLowerCase().includes(q) ||
        s.artist?.toLowerCase().includes(q)
    );
}

function renderSongsList() {
    const list = getFilteredSongs();
    songCountEl.textContent = `${songs.length} canción${songs.length!==1?'es':''}`;

    if (songs.length === 0) {
        playlistEl.innerHTML = `
            <li class="empty-state">
                <div class="empty-icon">⚫</div>
                <p>No hay canciones aún</p>
                <small>Agrega música para empezar</small>
            </li>`;
        return;
    }

    if (list.length === 0) {
        playlistEl.innerHTML = `
            <li class="empty-state">
                <div class="empty-icon">🔍</div>
                <p>Sin resultados</p>
                <small>"${escapeHtml(searchQuery)}"</small>
            </li>`;
        return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(s => {
        const li = document.createElement('li');
        li.dataset.id = s.id;
        const isActive = songs[currentIndex]?.id === s.id;
        if (isActive) li.classList.add('active');
        const hasNote = s.note && s.note.trim().length > 0;

        li.innerHTML = `
            <div class="song-item-info">
                <div class="song-item-title">${escapeHtml(s.title)}</div>
                <div class="song-item-meta">${escapeHtml(s.artist)} · ${(s.size/1024/1024).toFixed(1)} MB</div>
            </div>
            <div class="song-item-actions">
                <button class="song-act-btn note-btn ${hasNote?'note-has-content':''}" data-id="${s.id}" title="${hasNote?'Ver nota':'Agregar nota'}">📝</button>
                <button class="song-act-btn lyrics-btn" data-id="${s.id}" title="Ver letras">📖</button>
                <button class="song-act-btn del del-btn" data-id="${s.id}" title="Eliminar">🗑</button>
            </div>`;
        frag.appendChild(li);
    });

    playlistEl.innerHTML = '';
    playlistEl.appendChild(frag);
    playlistEl.removeEventListener('click', handlePlaylistClick);
    playlistEl.addEventListener('click', handlePlaylistClick);
}

function handlePlaylistClick(e) {
    const del     = e.target.closest('.del-btn');
    const lyrics  = e.target.closest('.lyrics-btn');
    const noteBtn = e.target.closest('.note-btn');
    const li      = e.target.closest('li[data-id]');

    if (del) {
        e.stopPropagation();
        if (confirm('¿Eliminar esta canción?')) {
            deleteSong(parseInt(del.dataset.id)).then(() => loadSongs());
        }
    } else if (lyrics) {
        e.stopPropagation();
        const s = songs.find(s=>s.id===parseInt(lyrics.dataset.id));
        if (s) showLyricsModal(s);
    } else if (noteBtn) {
        e.stopPropagation();
        openNoteModal(parseInt(noteBtn.dataset.id));
    } else if (li) {
        const idx = songs.findIndex(s=>s.id===parseInt(li.dataset.id));
        if (idx !== -1) playSong(idx);
    }
}

// ==================== PLAYBACK ====================
async function playSong(index) {
    if (index < 0 || index >= songs.length) return;
    currentIndex = index;
    const s = songs[currentIndex];

    songTitleEl.textContent  = s.title  || 'Sin título';
    songArtistEl.textContent = s.artist || '— —';

    coverImg.src = s.coverUrl ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23111'/%3E%3Ccircle cx='100' cy='100' r='40' fill='none' stroke='%23333' stroke-width='2'/%3E%3Ccircle cx='100' cy='100' r='8' fill='%23333'/%3E%3C/svg%3E";

    const url = await getAudioUrl(s.id);
    if (!url) return;
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = url;
    audio.load();
    audio.oncanplay = () => {
        audio.play()
            .then(() => { playPauseBtn.textContent='⏸'; startCoverSpin(); })
            .catch(err => console.warn('Reproducción bloqueada:', err));
    };

    renderSongsList();
    document.getElementById('game-song-name').textContent = s.title || '—';
}

function playPause() {
    if (!audio.src) return;
    if (audio.paused) {
        audio.play().then(() => { playPauseBtn.textContent='⏸'; startCoverSpin(); });
    } else {
        audio.pause();
        playPauseBtn.textContent='▶';
        stopCoverSpin();
    }
}

function startCoverSpin() {
    coverImg.classList.add('spinning');
    coverRing.classList.add('spinning');
}

function stopCoverSpin() {
    coverImg.classList.remove('spinning');
    coverRing.classList.remove('spinning');
}

// ==================== NAVIGATION ====================
function getNextIndex() {
    if (songs.length === 0) return -1;
    if (isShuffled) {
        if (!shuffleQueue.length) generateShuffleQueue();
        const pos = shuffleQueue.indexOf(currentIndex);
        if (pos !== -1) shuffleQueue.splice(pos, 1);
        if (!shuffleQueue.length) generateShuffleQueue();
        return shuffleQueue[0];
    }
    return (currentIndex + 1) % songs.length;
}

function getPrevIndex() {
    if (songs.length === 0) return -1;
    return (currentIndex - 1 + songs.length) % songs.length;
}

function nextSong() { const i = getNextIndex(); if (i !== -1) playSong(i); }
function prevSong()  { playSong(getPrevIndex()); }

audio.addEventListener('ended', () => {
    stopCoverSpin();
    if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().then(() => startCoverSpin());
        return;
    }
    if (songs.length <= 1 && repeatMode === 'none') {
        playPauseBtn.textContent = '▶';
        return;
    }
    nextSong();
});

// ==================== REPEAT / SHUFFLE ====================
function toggleShuffle() {
    isShuffled = !isShuffled;
    shuffleBtn.dataset.active = isShuffled;
    if (isShuffled) generateShuffleQueue();
}

function toggleRepeat() {
    const modes = ['none','all','one'];
    const idx = modes.indexOf(repeatMode);
    repeatMode = modes[(idx+1) % modes.length];
    const icons = { none:'↺', all:'🔁', one:'🔂' };
    repeatBtn.textContent = icons[repeatMode];
    repeatBtn.dataset.active = repeatMode !== 'none';
    repeatBtn.title = { none:'Repetir', all:'Repetir todo', one:'Repetir canción' }[repeatMode];
}

shuffleBtn.addEventListener('click', toggleShuffle);
repeatBtn.addEventListener('click', toggleRepeat);

// ==================== PROGRESS ====================
audio.addEventListener('timeupdate', throttle(() => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressBar.value = pct;
    progressFill.style.width = `${pct}%`;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    durationEl.textContent    = formatTime(audio.duration);
}, 200));

audio.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(audio.duration);
});

progressBar.addEventListener('input', () => {
    if (audio.duration)
        audio.currentTime = (progressBar.value / 100) * audio.duration;
});

volumeCtrl.addEventListener('input', () => { audio.volume = volumeCtrl.value; });
playPauseBtn.addEventListener('click', playPause);
nextBtn.addEventListener('click', nextSong);
prevBtn.addEventListener('click', prevSong);

// ==================== LOAD SONGS ====================
async function loadSongs() {
    songs = await getSongs();
    songs.reverse();
    let total = 0;
    songs.forEach(s => total += s.size||0);
    storageUsedEl.textContent = `${(total/1024/1024).toFixed(1)} MB`;
    renderSongsList();
    if (songs.length > 0 && !audio.src) playSong(0);
}

// ==================== UPLOAD FILE ====================
async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
        if (!file.type.includes('audio')) continue;
        const title = file.name.replace(/\.[^/.]+$/, '');
        const blob  = new Blob([await file.arrayBuffer()], { type: file.type });
        await saveSong(title, 'Local', blob, true);
    }
    await loadSongs();
}

document.getElementById('add-music-btn').addEventListener('click', () => {
    const choice = confirm('📂 Archivo local → Aceptar\n🌐 Descargar URL → Cancelar');
    if (choice) fileInput.click();
    else openModal('download-modal');
});

fileInput.addEventListener('change', e => {
    if (e.target.files.length) uploadFiles(e.target.files);
    fileInput.value = '';
});

document.getElementById('add-playlist-btn').addEventListener('click', () => openModal('playlist-download-modal'));

// ==================== SEARCH ====================
searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderSongsList();
});

// ==================== MODAL SYSTEM ====================
function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display='flex'; m.classList.add('open'); }
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display='none'; m.classList.remove('open'); }
}

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        const id = btn.dataset.modal;
        if (id) closeModal(id);
        else btn.closest('.modal')?.style && (btn.closest('.modal').style.display = 'none');
    });
});

document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
});

// ==================== HELPER: llamar al backend y recibir blob ====================
async function fetchFromBackend(endpoint, body) {
    // Verificar que el backend esté vivo (Render free tier se duerme)
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000) // 5 min timeout
    });
    return response;
}

// ==================== DOWNLOAD SINGLE SONG ====================
document.getElementById('confirm-download').addEventListener('click', async () => {
    const url    = document.getElementById('download-url').value.trim();
    const title  = document.getElementById('song-title-input').value.trim();
    const artist = document.getElementById('artist-input').value.trim();
    if (!url) return alert('Ingresa una URL');

    const btn  = document.getElementById('confirm-download');
    const prog = document.getElementById('download-progress-container');
    const fill = document.getElementById('download-progress-fill');
    const pct  = document.getElementById('download-progress-percent');
    btn.disabled = true;
    btn.textContent = '⏳ Conectando...';
    prog.style.display = 'block';

    // Animación de progreso indeterminado mientras el backend trabaja
    let fakeProgress = 0;
    const fakeTimer = setInterval(() => {
        fakeProgress = Math.min(fakeProgress + 2, 85);
        fill.style.width = `${fakeProgress}%`;
        pct.textContent  = Math.round(fakeProgress);
        btn.textContent  = `⏳ Procesando ${Math.round(fakeProgress)}%`;
    }, 600);

    try {
        const response = await fetchFromBackend('/api/download', { url });

        clearInterval(fakeTimer);
        fill.style.width = '95%';
        pct.textContent  = '95';
        btn.textContent  = '💾 Guardando...';

        if (!response.ok) {
            let errMsg = 'Error en el servidor';
            try { errMsg = (await response.json()).error || errMsg; } catch {}
            throw new Error(errMsg);
        }

        // El backend responde con el MP3 directo — guardarlo en IndexedDB
        const blob = await response.blob();

        // Intentar obtener el título real desde el header
        const serverTitle = response.headers.get('X-Song-Title');
        const finalTitle  = title || serverTitle || 'Descargada';
        const finalArtist = artist || 'YouTube';

        await saveSong(finalTitle, finalArtist, blob, true);
        await loadSongs();

        fill.style.width = '100%';
        pct.textContent  = '100';
        closeModal('download-modal');
        document.getElementById('download-url').value = '';
        document.getElementById('song-title-input').value = '';
        document.getElementById('artist-input').value = '';
        alert(`✅ "${finalTitle}" guardada en tu biblioteca`);

    } catch (err) {
        clearInterval(fakeTimer);
        console.error('Error descarga:', err);
        let msg = err.message;
        if (err.name === 'TimeoutError') msg = 'Tiempo de espera agotado. El backend tardó más de 5 min.';
        if (msg.includes('Failed to fetch')) msg = 'No se pudo conectar al backend.\n¿Está activo en Render?\n' + BACKEND_URL;
        alert('❌ Error: ' + msg);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Descargar';
        prog.style.display = 'none';
        fill.style.width = '0%';
    }
});

// ==================== DOWNLOAD PLAYLIST ====================
// ARQUITECTURA CORRECTA:
//  1. /playlist-info  → backend devuelve lista [{id, title, url}] SIN descargar
//  2. /download        → por cada canción, backend descarga y hace STREAM del MP3 al browser
//  3. Frontend recibe cada blob y lo guarda en IndexedDB
document.getElementById('confirm-playlist-download').addEventListener('click', async () => {
    const url  = document.getElementById('playlist-url').value.trim();
    const name = document.getElementById('playlist-name-input').value.trim();
    if (!url) return alert('Ingresa una URL de playlist de YouTube');

    const progContainer = document.getElementById('playlist-progress-container');
    const progFill      = document.getElementById('playlist-progress-fill');
    const progPct       = document.getElementById('playlist-progress-percent');
    const progCounter   = document.getElementById('playlist-progress-counter');
    const currentSong   = document.getElementById('playlist-current-song');
    const skipLog       = document.getElementById('playlist-skip-log');
    const btn           = document.getElementById('confirm-playlist-download');

    btn.disabled = true;
    progContainer.style.display = 'block';
    skipLog.textContent = '';

    try {
        // ── PASO 1: obtener lista de canciones ──
        currentSong.textContent = '📡 Obteniendo lista de canciones...';
        progFill.style.width = '2%';

        const infoRes = await fetchFromBackend('/api/playlist-info', { url });
        if (!infoRes.ok) {
            let errMsg = 'Error obteniendo playlist';
            try { errMsg = (await infoRes.json()).error || errMsg; } catch {}
            throw new Error(errMsg);
        }

        const info  = await infoRes.json();
        const list  = info.songs || [];
        const total = list.length;

        if (total === 0) throw new Error('La playlist está vacía o es privada');

        currentSong.textContent = `📋 ${total} canciones encontradas en "${info.name}"`;
        await new Promise(r => setTimeout(r, 800)); // pequeña pausa para que el usuario lo vea

        let downloaded = 0, skipped = 0, failed = 0;

        // ── PASO 2: descargar canción por canción (stream al browser) ──
        for (let i = 0; i < list.length; i++) {
            const song = list[i];

            // Separar artista y título del formato "Artista - Título"
            let songTitle  = song.title || 'Sin título';
            let songArtist = 'YouTube';
            if (songTitle.includes(' - ')) {
                const parts = songTitle.split(' - ');
                songArtist = parts[0].trim();
                songTitle  = parts.slice(1).join(' - ').trim();
            }

            const pct = Math.round(((i + 1) / total) * 100);
            progFill.style.width  = `${pct}%`;
            progPct.textContent   = pct;
            progCounter.textContent = `(${i+1}/${total})`;
            currentSong.textContent  = `🎵 ${songTitle}`;

            // Verificar si ya existe en la biblioteca
            const exists = await songExists(songTitle, songArtist);
            if (exists) {
                skipped++;
                skipLog.textContent = `⏭ Ya existían: ${skipped}`;
                continue;
            }

            try {
                // Llamar al backend para descargar ESTA canción específica
                const dlRes = await fetchFromBackend('/api/download', { url: song.url });

                if (!dlRes.ok) {
                    let e = 'Error';
                    try { e = (await dlRes.json()).error || e; } catch {}
                    throw new Error(e);
                }

                // Recibir el MP3 como blob y guardarlo en IndexedDB
                const blob = await dlRes.blob();
                if (blob.size < 5000) throw new Error('Archivo demasiado pequeño (posible error)');

                await saveSong(songTitle, songArtist, blob, true);
                downloaded++;

                // Actualizar el log de omitidas
                if (skipped > 0) skipLog.textContent = `⏭ Ya existían: ${skipped}`;

                // Pequeña pausa entre canciones para no saturar el servidor
                await new Promise(r => setTimeout(r, 500));

            } catch (songErr) {
                console.warn(`❌ Error con "${songTitle}":`, songErr.message);
                failed++;
                currentSong.textContent = `⚠️ Error en: ${songTitle} — continuando...`;
                await new Promise(r => setTimeout(r, 300));
            }
        }

        await loadSongs();
        closeModal('playlist-download-modal');
        document.getElementById('playlist-url').value = '';
        document.getElementById('playlist-name-input').value = '';

        alert(
            `✅ Playlist "${name || info.name}" completada\n\n` +
            `📀 Descargadas: ${downloaded}\n` +
            `⏭ Ya existían (omitidas): ${skipped}\n` +
            `❌ Con error: ${failed}`
        );

    } catch (err) {
        console.error('Error playlist:', err);
        let msg = err.message;
        if (err.name === 'TimeoutError')   msg = 'Tiempo agotado. El servidor tardó demasiado.';
        if (msg.includes('Failed to fetch')) msg = `No se pudo conectar al backend.\nVerifica que esté activo:\n${BACKEND_URL}`;
        alert('❌ Error: ' + msg);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Descargar playlist';
        progContainer.style.display = 'none';
        progFill.style.width = '0%';
    }
});

// ==================== LYRICS MODAL ====================
function showLyricsModal(song) {
    document.getElementById('lyrics-title').textContent   = song.title  || 'Letras';
    document.getElementById('lyrics-artist-label').textContent = song.artist || '';
    const body = document.getElementById('lyrics-body');
    if (song.lyrics) {
        body.innerHTML = `<pre>${escapeHtml(song.lyrics)}</pre>`;
    } else {
        body.innerHTML = `
            <p style="text-align:center; color:var(--muted); padding:20px;">Sin letras disponibles</p>
            <button class="modal-btn" id="search-lyrics-btn" style="margin-top:8px;">🔄 Buscar letras</button>`;
        document.getElementById('search-lyrics-btn')?.addEventListener('click', async () => {
            const lyrics = await fetchLyrics(song.artist, song.title);
            if (lyrics) {
                await updateSongField(song.id, 'lyrics', lyrics);
                await loadSongs();
                const updated = songs.find(s=>s.id===song.id);
                if (updated) showLyricsModal(updated);
            } else alert('❌ No se encontraron letras');
        });
    }
    openModal('lyrics-modal');
}

// ==================== NOTE MODAL ====================
function openNoteModal(songId) {
    const s = songs.find(s=>s.id===songId);
    if (!s) return;
    noteSongId = songId;
    document.getElementById('note-song-label').textContent = `${s.title} — ${s.artist}`;
    document.getElementById('note-textarea').value = s.note || '';
    openModal('note-modal');
}

document.getElementById('save-note-btn').addEventListener('click', async () => {
    if (!noteSongId) return;
    const note = document.getElementById('note-textarea').value.trim();
    await updateSongField(noteSongId, 'note', note);
    await loadSongs();
    closeModal('note-modal');
    noteSongId = null;
});

// ==================== PLAYLISTS ====================
function loadPlaylists() {
    const saved = localStorage.getItem('blackbox_playlists');
    playlists = saved ? JSON.parse(saved) : [];
    renderPlaylistsList();
}

function savePlaylists() {
    localStorage.setItem('blackbox_playlists', JSON.stringify(playlists));
}

function renderPlaylistsList() {
    const c = document.getElementById('playlists-list');
    if (!c) return;
    if (!playlists.length) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Sin playlists todavía</p></div>`;
        return;
    }
    c.innerHTML = playlists.map(p=>`
        <div class="playlist-item" data-id="${p.id}">
            <div class="playlist-item-header">
                <span class="playlist-item-name">${escapeHtml(p.name)}</span>
                <span class="playlist-item-count">${p.songIds.length} canción${p.songIds.length!==1?'es':''}</span>
            </div>
            <div class="playlist-item-actions">
                <button class="pl-btn pl-play" data-id="${p.id}">▶ Reproducir</button>
                <button class="pl-btn pl-share" data-id="${p.id}">📤 Compartir</button>
                <button class="pl-btn pl-edit" data-id="${p.id}">✏️ Editar</button>
                <button class="pl-btn del pl-delete" data-id="${p.id}">🗑</button>
            </div>
        </div>`).join('');

    c.querySelectorAll('.pl-play').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();playPlaylist(b.dataset.id);}));
    c.querySelectorAll('.pl-share').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();sharePlaylist(b.dataset.id);}));
    c.querySelectorAll('.pl-edit').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openPlaylistModal(b.dataset.id);}));
    c.querySelectorAll('.pl-delete').forEach(b=>b.addEventListener('click',e=>{
        e.stopPropagation();
        if (confirm('¿Eliminar esta playlist?')) {
            playlists = playlists.filter(p=>p.id!==b.dataset.id);
            savePlaylists(); renderPlaylistsList();
        }
    }));
}

function playPlaylist(id) {
    const p = playlists.find(p=>p.id===id);
    if (!p || !p.songIds.length) return alert('Playlist vacía');
    const idx = songs.findIndex(s=>s.id===p.songIds[0]);
    if (idx !== -1) playSong(idx);
}

function sharePlaylist(id) {
    const p = playlists.find(p=>p.id===id);
    if (!p) return;
    const list = p.songIds.map(sid=>{
        const s = songs.find(s=>s.id===sid);
        return s ? `🎵 ${s.title} — ${s.artist}` : null;
    }).filter(Boolean).join('\n');
    const text = `⚫ BLACKBOX — ${p.name}\n\n${list}\n\n🎧 Escucha música libremente, sin anuncios:\n${window.location.href}`;
    if (navigator.share) {
        navigator.share({ title:`Playlist: ${p.name}`, text }).catch(()=>copyToClipboard(text));
    } else copyToClipboard(text, '✅ Playlist copiada al portapapeles');
}

function copyToClipboard(text, msg='✅ Copiado') {
    navigator.clipboard.writeText(text).then(()=>alert(msg)).catch(()=>{
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        ta.remove(); alert(msg);
    });
}

function openPlaylistModal(playlistId=null) {
    const nameInput  = document.getElementById('playlist-name');
    const titleEl    = document.getElementById('playlist-modal-title');
    const deleteBtn  = document.getElementById('delete-playlist-btn');
    const availDiv   = document.getElementById('available-songs');
    const saveBtn    = document.getElementById('save-playlist-btn');

    let pl = playlistId ? playlists.find(p=>p.id===playlistId) : null;

    titleEl.textContent  = pl ? `Editar: ${pl.name}` : 'Nueva Playlist';
    nameInput.value      = pl ? pl.name : '';
    deleteBtn.style.display = pl ? 'block' : 'none';

    availDiv.innerHTML = songs.map(s=>`
        <div class="song-check-item">
            <input type="checkbox" id="chk_${s.id}" value="${s.id}" ${pl&&pl.songIds.includes(s.id)?'checked':''}>
            <label for="chk_${s.id}">
                ${escapeHtml(s.title)}
                <span class="ch-artist">— ${escapeHtml(s.artist)}</span>
            </label>
        </div>`).join('');

    openModal('playlist-modal');

    const newSave = saveBtn.cloneNode(true); saveBtn.parentNode.replaceChild(newSave, saveBtn);
    const newDel  = deleteBtn.cloneNode(true); deleteBtn.parentNode.replaceChild(newDel, deleteBtn);

    newSave.addEventListener('click', () => {
        const name     = nameInput.value.trim();
        if (!name) return alert('Ingresa un nombre');
        const selected = [...document.querySelectorAll('#available-songs input:checked')].map(cb=>parseInt(cb.value));
        if (pl) { pl.name=name; pl.songIds=selected; }
        else playlists.push({ id:Date.now().toString(), name, songIds:selected });
        savePlaylists(); renderPlaylistsList(); closeModal('playlist-modal');
    });

    newDel.addEventListener('click', () => {
        if (pl && confirm(`¿Eliminar "${pl.name}"?`)) {
            playlists = playlists.filter(p=>p.id!==pl.id);
            savePlaylists(); renderPlaylistsList(); closeModal('playlist-modal');
        }
    });
}

document.getElementById('create-playlist-btn')?.addEventListener('click', ()=>openPlaylistModal());

// ==================== TABS ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
        document.getElementById(`${btn.dataset.tab}-tab`)?.classList.add('active');
        if (btn.dataset.tab==='playlists') renderPlaylistsList();
    });
});

// ==================== SHARE APP ====================
document.getElementById('share-app-btn').addEventListener('click', () => {
    const appUrl   = window.location.origin || 'https://blackbox-music.netlify.app';
    const nativeBtn = document.getElementById('native-share-btn');
    document.getElementById('share-url-display').textContent = appUrl;

    if (navigator.share) nativeBtn.style.display = 'block';

    openModal('share-app-modal');
});

document.getElementById('copy-share-link').addEventListener('click', () => {
    const appUrl = window.location.origin || 'https://blackbox-music.netlify.app';
    const text   = `🎧 Escucha música libremente, sin anuncios y sin algoritmos.\n⚫ BLACKBOX — tu reproductor offline personal.\n\n${appUrl}`;
    copyToClipboard(text, '✅ Enlace copiado');
});

document.getElementById('native-share-btn').addEventListener('click', () => {
    const appUrl = window.location.origin || 'https://blackbox-music.netlify.app';
    navigator.share({
        title: '⚫ BlackBox — Música libre',
        text:  'Escucha música libremente, sin anuncios ni algoritmos.',
        url:   appUrl
    }).catch(()=>{});
});

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.code==='Space') { e.preventDefault(); playPause(); }
    if (e.code==='ArrowRight') nextSong();
    if (e.code==='ArrowLeft')  prevSong();
});

// ==================== GAME SYSTEM ====================
const gameOverlay  = document.getElementById('game-overlay');
const closeGameBtn = document.getElementById('close-game-btn');
const gameTabBtns  = document.querySelectorAll('.game-tab-btn');

document.getElementById('game-btn').addEventListener('click', () => {
    gameOverlay.style.display = 'flex';
    document.getElementById('game-song-name').textContent = songs[currentIndex]?.title || '—';
});

closeGameBtn.addEventListener('click', () => {
    gameOverlay.style.display = 'none';
    stopArcade();
});

gameTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        gameTabBtns.forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.game-panel').forEach(p=>p.classList.remove('active'));
        document.getElementById(`${btn.dataset.game}-game`)?.classList.add('active');
        if (btn.dataset.game === 'arcade') initArcadeIfNeeded();
    });
});

// ========== PIXEL ART GAME ==========
(function initPixelArt() {
    const canvas = document.getElementById('pixel-canvas');
    const ctx    = canvas.getContext('2d');
    const COLS=32, ROWS=32;
    const CW = canvas.width / COLS;
    const CH = canvas.height / ROWS;
    const PALETTE = [
        '#000000','#1a1a2e','#c9a87b','#e8d5b5','#6b9b6b',
        '#9b3a2a','#4a90d9','#f5f5f5','#888888','#ffcc00',
        '#ff6b6b','#a8e6cf','#ffd3b6','#d4a5a5','#3d5a80'
    ];
    let selectedColor = PALETTE[2];
    let drawing = false;

    const grid = Array.from({length:ROWS},()=>Array(COLS).fill(''));

    const paletteEl = document.getElementById('color-palette');
    PALETTE.forEach(c => {
        const sw = document.createElement('div');
        sw.className = 'color-swatch' + (c===selectedColor?' selected':'');
        sw.style.background = c;
        sw.addEventListener('click', () => {
            selectedColor = c;
            document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
            sw.classList.add('selected');
        });
        paletteEl.appendChild(sw);
    });

    function drawGrid() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
            if (grid[r][c]) {
                ctx.fillStyle = grid[r][c];
                ctx.fillRect(c*CW, r*CH, CW, CH);
            }
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        for (let c=0;c<=COLS;c++) { ctx.beginPath(); ctx.moveTo(c*CW,0); ctx.lineTo(c*CW,canvas.height); ctx.stroke(); }
        for (let r=0;r<=ROWS;r++) { ctx.beginPath(); ctx.moveTo(0,r*CH); ctx.lineTo(canvas.width,r*CH); ctx.stroke(); }
    }

    function paint(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;
        const x  = (e.clientX||e.touches?.[0]?.clientX) - rect.left;
        const y  = (e.clientY||e.touches?.[0]?.clientY) - rect.top;
        const col = Math.floor(x * scaleX / CW);
        const row = Math.floor(y * scaleY / CH);
        if (row>=0&&row<ROWS&&col>=0&&col<COLS) {
            grid[row][col] = selectedColor;
            drawGrid();
        }
    }

    canvas.addEventListener('mousedown', e=>{drawing=true;paint(e);});
    canvas.addEventListener('mousemove', e=>{if(drawing)paint(e);});
    canvas.addEventListener('mouseup', ()=>drawing=false);
    canvas.addEventListener('mouseleave', ()=>drawing=false);
    canvas.addEventListener('touchstart', e=>{e.preventDefault();drawing=true;paint(e);},{passive:false});
    canvas.addEventListener('touchmove', e=>{e.preventDefault();if(drawing)paint(e);},{passive:false});
    canvas.addEventListener('touchend', ()=>drawing=false);

    document.getElementById('pixel-clear-btn').addEventListener('click', () => {
        for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) grid[r][c]='';
        drawGrid();
    });

    document.getElementById('pixel-save-btn').addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'blackbox-pixel.png';
        link.href = canvas.toDataURL();
        link.click();
    });

    drawGrid();
})();

// ========== ARCADE GAME ==========
let arcadeState = null;
let arcadeAF    = null;
let arcadeInited = false;

function initArcadeIfNeeded() {
    if (!arcadeInited) { arcadeInited=true; }
}

function stopArcade() {
    if (arcadeAF) { cancelAnimationFrame(arcadeAF); arcadeAF=null; }
}

document.getElementById('arcade-start-btn').addEventListener('click', startArcade);

function startArcade() {
    stopArcade();
    const canvas = document.getElementById('arcade-canvas');
    const ctx    = canvas.getContext('2d');
    const W=canvas.width, H=canvas.height;

    arcadeState = {
        player: { x:W/2-18, y:H-60, w:36, h:22, dx:0, speed:4 },
        bullets: [],
        enemies: [],
        score: 0,
        lives: 3,
        level: 1,
        frame: 0,
        lastShot: 0,
        over: false
    };

    function spawnEnemies(level) {
        const cols=6, rows=2+Math.min(level,3);
        for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
            arcadeState.enemies.push({
                x: 30 + c*42, y: 30 + r*30,
                w:28, h:18, alive:true,
                dx: (0.7+level*0.2) * (c%2===0?1:-1),
                dy: 0
            });
        }
    }
    spawnEnemies(1);

    function updateScore() {
        document.getElementById('arcade-score').textContent = arcadeState.score;
        document.getElementById('arcade-lives').textContent = arcadeState.lives;
        document.getElementById('arcade-level').textContent = arcadeState.level;
    }

    function drawShip(x,y,w,h,color,dir=1) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x+w/2, dir===1?y:y+h);
        ctx.lineTo(x, dir===1?y+h:y);
        ctx.lineTo(x+w, dir===1?y+h:y);
        ctx.closePath();
        ctx.fill();
    }

    function loop(ts) {
        arcadeAF = requestAnimationFrame(loop);
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle='#060810'; ctx.fillRect(0,0,W,H);

        ctx.fillStyle='rgba(255,255,255,0.3)';
        for(let i=0;i<40;i++){
            const sx=(i*73+arcadeState.frame*0.2)%W;
            const sy=(i*37+arcadeState.frame*0.5)%H;
            ctx.fillRect(sx,sy,1,1);
        }

        const s = arcadeState;
        if (s.over) {
            ctx.fillStyle='#c9a87b';
            ctx.font='bold 28px Syne,sans-serif';
            ctx.textAlign='center';
            ctx.fillText('GAME OVER', W/2, H/2-10);
            ctx.font='14px Space Mono,monospace';
            ctx.fillText(`Score: ${s.score}`, W/2, H/2+20);
            return;
        }

        s.frame++;

        s.player.x += s.player.dx * s.player.speed;
        s.player.x = Math.max(0, Math.min(W-s.player.w, s.player.x));

        drawShip(s.player.x, s.player.y, s.player.w, s.player.h, '#c9a87b');

        if (ts - s.lastShot > 800) {
            s.bullets.push({ x: s.player.x+s.player.w/2-2, y: s.player.y, w:4, h:10, dy:-8 });
            s.lastShot = ts;
        }

        s.bullets = s.bullets.filter(b=>b.y>-20);
        s.bullets.forEach(b=>{
            b.y += b.dy;
            ctx.fillStyle = b.dy<0 ? '#e8d5b5' : '#ff6b6b';
            ctx.fillRect(b.x, b.y, b.w, b.h);
        });

        let touchEdge = false;
        s.enemies.filter(e=>e.alive).forEach(e=>{
            e.x += e.dx;
            if (e.x<=0||e.x+e.w>=W) touchEdge=true;
        });
        if (touchEdge) {
            s.enemies.forEach(e=>{ if(e.alive){e.dx*=-1; e.y+=10;} });
        }

        if (s.frame%90===0) {
            const alive = s.enemies.filter(e=>e.alive);
            if (alive.length) {
                const shooter = alive[Math.floor(Math.random()*alive.length)];
                s.bullets.push({ x:shooter.x+shooter.w/2-2, y:shooter.y+shooter.h, w:4, h:8, dy:5 });
            }
        }

        s.enemies.forEach(e=>{
            if (!e.alive) return;
            drawShip(e.x, e.y, e.w, e.h, '#9b3a2a', -1);

            if (e.y+e.h >= s.player.y) { s.lives--; e.alive=false; updateScore(); if(s.lives<=0){s.over=true;} }

            s.bullets.forEach(b=>{
                if (b.dy<0 && b.x<e.x+e.w && b.x+b.w>e.x && b.y<e.y+e.h && b.y+b.h>e.y) {
                    e.alive=false; b.y=-999; s.score+=10; updateScore();
                }
            });

            s.bullets.forEach(b=>{
                if (b.dy>0 && b.x<s.player.x+s.player.w && b.x+b.w>s.player.x &&
                    b.y<s.player.y+s.player.h && b.y+b.h>s.player.y) {
                    b.y=-999; s.lives--; updateScore(); if(s.lives<=0) s.over=true;
                }
            });
        });

        if (s.enemies.every(e=>!e.alive)) {
            s.level++;
            spawnEnemies(s.level);
            updateScore();
        }
    }

    updateScore();
    arcadeAF = requestAnimationFrame(loop);
}

const setDir = (dx) => { if (arcadeState && !arcadeState.over) arcadeState.player.dx=dx; };
document.getElementById('ac-left').addEventListener('mousedown',  ()=>setDir(-1));
document.getElementById('ac-left').addEventListener('touchstart',  e=>{e.preventDefault();setDir(-1);},{passive:false});
document.getElementById('ac-right').addEventListener('mousedown', ()=>setDir(1));
document.getElementById('ac-right').addEventListener('touchstart', e=>{e.preventDefault();setDir(1);},{passive:false});
document.getElementById('ac-fire').addEventListener('mousedown',  ()=>{
    if (arcadeState&&!arcadeState.over){
        arcadeState.bullets.push({x:arcadeState.player.x+arcadeState.player.w/2-2,y:arcadeState.player.y,w:4,h:10,dy:-12});
    }
});
['ac-left','ac-right'].forEach(id=>{
    const el = document.getElementById(id);
    el.addEventListener('mouseup',   ()=>setDir(0));
    el.addEventListener('touchend',  ()=>setDir(0));
    el.addEventListener('mouseleave',()=>setDir(0));
});

document.addEventListener('keydown', e=>{
    if (!arcadeState||arcadeState.over) return;
    if (e.key==='ArrowLeft')  setDir(-1);
    if (e.key==='ArrowRight') setDir(1);
    if (e.key===' '&&document.activeElement.tagName!=='INPUT') {
        arcadeState.bullets.push({x:arcadeState.player.x+arcadeState.player.w/2-2,y:arcadeState.player.y,w:4,h:10,dy:-12});
    }
});
document.addEventListener('keyup', e=>{
    if (e.key==='ArrowLeft'||e.key==='ArrowRight') setDir(0);
});

// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(()=>{});
    });
}

// ==================== INIT ====================
(async function start() {
    await initDB();
    if (db) {
        await loadSongs();
        loadPlaylists();
        console.log('✅ BlackBox listo');
    }
})();