// ==================== REPRODUCTOR COMPLETO ====================
console.log('🎵 MusicBox iniciando...');

const audio = document.getElementById('audio-player');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressBar = document.getElementById('progress-bar');
const currentTimeSpan = document.getElementById('current-time');
const durationSpan = document.getElementById('duration');
const volumeControl = document.getElementById('volume-control');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');
const coverImg = document.getElementById('cover-img');
const playlistEl = document.getElementById('playlist');
const addMusicBtn = document.getElementById('add-music-btn');
const fileInput = document.getElementById('file-input');
const storageUsedSpan = document.getElementById('storage-used');

// Modal
const modal = document.getElementById('download-modal');
const closeModal = document.querySelector('.close-modal');
const confirmDownload = document.getElementById('confirm-download');
const downloadUrl = document.getElementById('download-url');
const songTitleInput = document.getElementById('song-title-input');
const artistInput = document.getElementById('artist-input');

let songs = [];
let currentIndex = 0;
let db = null;
let playlists = [];

// ==================== INDEXEDDB ====================
function initDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open('MusicBoxBrave', 1);
        
        request.onerror = () => {
            console.log('❌ Error DB');
            resolve(null);
        };
        
        request.onsuccess = (e) => {
            db = e.target.result;
            console.log('✅ DB lista');
            resolve(db);
        };
        
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('songs')) {
                db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('audio')) {
                db.createObjectStore('audio', { keyPath: 'id' });
            }
            console.log('✅ Stores creadas');
        };
    });
}

// ==================== BUSCAR PORTADA ====================
async function fetchAlbumCover(artist, title) {
    if (!artist || !title || artist === 'Local' || artist === 'Web') return null;
    try {
        const searchTerm = encodeURIComponent(`${artist} ${title}`);
        const response = await fetch(`https://itunes.apple.com/search?term=${searchTerm}&limit=1&entity=song`);
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            let artworkUrl = data.results[0].artworkUrl100;
            if (artworkUrl) {
                return artworkUrl.replace('100x100', '600x600');
            }
        }
    } catch (error) {}
    return null;
}

// ==================== BUSCAR LETRAS ====================
async function fetchLyrics(artist, title) {
    if (!artist || !title || artist === 'Local' || artist === 'Web') return null;
    try {
        const response = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.lyrics && data.lyrics.length > 50) {
                console.log(`📝 Letras encontradas para: ${title}`);
                return data.lyrics;
            }
        }
    } catch (error) {}
    return null;
}

// ==================== GUARDAR CANCIÓN ====================
async function saveSong(title, artist, blob) {
    return new Promise(async (resolve, reject) => {
        let mimeType = blob.type;
        if (!mimeType || !mimeType.includes('audio')) mimeType = 'audio/mpeg';
        
        const correctedBlob = new Blob([blob], { type: mimeType });
        console.log(`💾 Guardando: ${title}`);
        
        const coverUrl = await fetchAlbumCover(artist, title);
        const lyrics = await fetchLyrics(artist, title);
        
        const tx = db.transaction(['songs', 'audio'], 'readwrite');
        const songStore = tx.objectStore('songs');
        const audioStore = tx.objectStore('audio');
        
        const songData = {
            title: title,
            artist: artist,
            size: correctedBlob.size,
            mimeType: mimeType,
            coverUrl: coverUrl,
            lyrics: lyrics,
            date: new Date().toISOString()
        };
        
        const songRequest = songStore.add(songData);
        songRequest.onsuccess = (e) => {
            const songId = e.target.result;
            audioStore.add({ id: songId, blob: correctedBlob }).onsuccess = () => {
                console.log(`✅ Guardado: ${title}`);
                resolve();
            };
            audioStore.onerror = reject;
        };
        songRequest.onerror = reject;
    });
}

function getSongs() {
    return new Promise((resolve) => {
        const tx = db.transaction(['songs'], 'readonly');
        tx.objectStore('songs').getAll().onsuccess = (e) => resolve(e.target.result || []);
    });
}

function getAudioUrl(id) {
    return new Promise((resolve) => {
        const tx = db.transaction(['audio'], 'readonly');
        tx.objectStore('audio').get(id).onsuccess = (e) => {
            if (e.target.result && e.target.result.blob) {
                resolve(URL.createObjectURL(e.target.result.blob));
            } else {
                resolve(null);
            }
        };
    });
}

function deleteSong(id) {
    return new Promise((resolve) => {
        const tx = db.transaction(['songs', 'audio'], 'readwrite');
        tx.objectStore('songs').delete(id);
        tx.objectStore('audio').delete(id);
        tx.oncomplete = () => resolve();
    });
}

// ==================== RENDER LISTA ====================
async function renderSongsList() {
    if (songs.length === 0) {
        playlistEl.innerHTML = '<li class="empty-playlist">🎵 No hay canciones. Agrega música</li>';
        songTitle.textContent = 'No hay canciones';
        songArtist.textContent = 'Agrega música';
        return;
    }
    
    playlistEl.innerHTML = songs.map(s => `
        <li data-id="${s.id}" style="padding:12px; margin-bottom:8px; background:rgba(0,0,0,0.4); border-radius:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center">
            <div style="flex:1">
                <div><strong>${escapeHtml(s.title)}</strong></div>
                <div style="font-size:0.8rem; color:#c9a87b">${escapeHtml(s.artist)}</div>
                <div style="font-size:0.7rem; color:#888">${(s.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <div style="display:flex; gap:5px">
                <button class="lyrics-btn" data-id="${s.id}" style="background:rgba(100,100,200,0.3); border:1px solid #6b9b6b; color:#a8c8a8; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem" title="Ver letras">📖</button>
                <button class="del-btn" data-id="${s.id}" style="background:#8b3a2a; border:none; color:white; padding:5px 10px; border-radius:5px; cursor:pointer">🗑️</button>
            </div>
        </li>
    `).join('');
    
    document.querySelectorAll('#playlist li').forEach(li => {
        li.addEventListener('click', async (e) => {
            if (e.target.classList.contains('del-btn')) return;
            if (e.target.classList.contains('lyrics-btn')) return;
            const id = parseInt(li.dataset.id);
            const index = songs.findIndex(s => s.id === id);
            if (index !== -1) await playSong(index);
        });
        
        li.querySelector('.del-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(e.target.dataset.id);
            if (confirm('¿Eliminar?')) {
                await deleteSong(id);
                await loadSongs();
            }
        });
        
        li.querySelector('.lyrics-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(e.target.dataset.id);
            const song = songs.find(s => s.id === id);
            if (song) showLyricsModal(song);
        });
    });
}

// ==================== REPRODUCIR ====================
async function playSong(index) {
    if (index < 0 || index >= songs.length) return;
    currentIndex = index;
    const song = songs[currentIndex];
    
    songTitle.textContent = song.title;
    songArtist.textContent = song.artist;
    
    if (song.coverUrl) {
        coverImg.src = song.coverUrl;
    } else {
        coverImg.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%232d3748'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23a0aec0' font-size='14'%3E🎵%3C/text%3E%3C/svg%3E";
    }
    
    const url = await getAudioUrl(song.id);
    if (url) {
        if (audio.src) URL.revokeObjectURL(audio.src);
        audio.src = url;
        audio.load();
        audio.oncanplay = () => audio.play().then(() => playPauseBtn.textContent = '⏸').catch(e => console.log(e));
    }
}

function playPause() {
    if (!audio.src) return;
    if (audio.paused) {
        audio.play().then(() => playPauseBtn.textContent = '⏸');
    } else {
        audio.pause();
        playPauseBtn.textContent = '▶';
    }
}

function nextSong() {
    if (songs.length === 0) return;
    playSong((currentIndex + 1) % songs.length);
}

function prevSong() {
    if (songs.length === 0) return;
    playSong((currentIndex - 1 + songs.length) % songs.length);
}

// ==================== LETRAS ====================
function showLyricsModal(song) {
    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal';
    modalDiv.style.display = 'flex';
    modalDiv.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <span class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>📖 ${escapeHtml(song.title)}</h3>
            <h4 style="color:#c9a87b">${escapeHtml(song.artist)}</h4>
            <div style="background:rgba(0,0,0,0.3); border-radius:12px; padding:15px; margin-top:15px; max-height:400px; overflow-y:auto">
                ${song.lyrics ? `<pre style="white-space:pre-wrap; font-size:0.85rem; color:#e8d5b5">${escapeHtml(song.lyrics)}</pre>` : `
                    <p style="text-align:center; color:#888">🎵 No hay letras disponibles</p>
                    <button class="modal-btn" onclick="searchLyrics(${song.id})" style="margin-top:10px">🔄 Buscar letras</button>
                `}
            </div>
        </div>
    `;
    document.body.appendChild(modalDiv);
    modalDiv.addEventListener('click', (e) => { if (e.target === modalDiv) modalDiv.remove(); });
}

window.searchLyrics = async function(songId) {
    const song = songs.find(s => s.id === songId);
    if (!song) return;
    const lyrics = await fetchLyrics(song.artist, song.title);
    if (lyrics) {
        const tx = db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        const get = store.get(songId);
        get.onsuccess = () => {
            const s = get.result;
            s.lyrics = lyrics;
            store.put(s);
            loadSongs();
            alert('✅ Letras encontradas');
            document.querySelector('.modal')?.remove();
            showLyricsModal(s);
        };
    } else {
        alert('❌ No se encontraron letras');
    }
};

// ==================== CARGAR CANCIONES ====================
async function loadSongs() {
    songs = await getSongs();
    songs.reverse();
    await renderSongsList();
    
    let totalSize = 0;
    songs.forEach(s => totalSize += s.size || 0);
    storageUsedSpan.textContent = `${(totalSize / 1024 / 1024).toFixed(2)} MB`;
    
    if (songs.length > 0 && !audio.src) {
        playSong(0);
    }
}

// ==================== SUBIR Y DESCARGAR ====================
async function uploadFile(file) {
    if (!file.type.includes('audio')) return alert('Selecciona un archivo de audio');
    const title = file.name.replace(/\.[^/.]+$/, "");
    const blob = await file.arrayBuffer().then(b => new Blob([b], { type: file.type }));
    await saveSong(title, 'Local', blob);
    await loadSongs();
    alert(`✅ ${title} agregada`);
}

async function downloadFromUrl(url, title, artist) {
    if (!url) return alert('Ingresa una URL');
    try {
        confirmDownload.disabled = true;
        confirmDownload.textContent = 'Descargando...';
        document.getElementById('download-progress-container').style.display = 'block';
        const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
        const blob = await response.blob();
        await saveSong(title || 'Descargada', artist || 'Web', blob);
        await loadSongs();
        modal.style.display = 'none';
        alert('✅ Descarga completada');
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        confirmDownload.disabled = false;
        confirmDownload.textContent = 'Descargar';
        document.getElementById('download-progress-container').style.display = 'none';
    }
}

// ==================== DESCARGAR DESDE YOUTUBE ====================
async function downloadFromYouTube(url, title, artist) {
    if (!url) return alert('Ingresa una URL de YouTube');
    try {
        confirmDownload.disabled = true;
        confirmDownload.textContent = '🎬 Descargando de YouTube...';
        document.getElementById('download-progress-container').style.display = 'block';
        
        const response = await fetch(`/api/download-youtube?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Error en descarga de YouTube');
        
        let blob = await response.blob();
        
        // FORZAR tipo MIME a audio/mpeg
        blob = new Blob([blob], { type: 'audio/mpeg' });
        console.log('📥 YouTube descargado:', blob.size, 'bytes, tipo:', blob.type);
        
        await saveSong(title || 'Canción de YouTube', artist || 'YouTube', blob);
        await loadSongs();
        
        modal.style.display = 'none';
        alert('✅ Descarga completada');
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        confirmDownload.disabled = false;
        confirmDownload.textContent = 'Descargar';
        document.getElementById('download-progress-container').style.display = 'none';
    }
}
// ==================== PLAYLISTS ====================
function loadPlaylists() {
    const saved = localStorage.getItem('musicbox_playlists');
    playlists = saved ? JSON.parse(saved) : [];
    renderPlaylistsList();
}

function savePlaylists() {
    localStorage.setItem('musicbox_playlists', JSON.stringify(playlists));
}

function renderPlaylistsList() {
    const container = document.getElementById('playlists-list');
    if (!container) return;
    if (playlists.length === 0) {
        container.innerHTML = '<div class="empty-playlist">📀 No hay playlists. Crea una nueva</div>';
        return;
    }
    container.innerHTML = playlists.map(p => `
        <div class="playlist-item" data-id="${p.id}" style="background:rgba(0,0,0,0.4); border-radius:16px; padding:15px; margin-bottom:12px">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px">
                <span style="font-size:1.1rem; font-weight:600; color:#e8d5b5">${escapeHtml(p.name)}</span>
                <span style="font-size:0.7rem; background:rgba(0,0,0,0.5); padding:2px 8px; border-radius:12px">${p.songIds.length} canciones</span>
            </div>
            <div style="display:flex; gap:10px; margin-top:10px">
                <button class="playlist-play" data-id="${p.id}" style="background:rgba(0,0,0,0.5); border:1px solid #9b7b4c; color:#c9a87b; padding:5px 12px; border-radius:20px; cursor:pointer">▶ Reproducir</button>
                <button class="playlist-share" data-id="${p.id}" style="background:rgba(0,0,0,0.5); border:1px solid #9b7b4c; color:#c9a87b; padding:5px 12px; border-radius:20px; cursor:pointer">📤 Compartir</button>
                <button class="playlist-edit" data-id="${p.id}" style="background:rgba(0,0,0,0.5); border:1px solid #9b7b4c; color:#c9a87b; padding:5px 12px; border-radius:20px; cursor:pointer">✏️ Editar</button>
                <button class="playlist-delete" data-id="${p.id}" style="background:rgba(0,0,0,0.5); border:1px solid #9b7b4c; color:#c9a87b; padding:5px 12px; border-radius:20px; cursor:pointer">🗑️ Eliminar</button>
            </div>
        </div>
    `).join('');
    
    document.querySelectorAll('.playlist-play').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            playPlaylist(btn.dataset.id);
        });
    });
    document.querySelectorAll('.playlist-share').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            sharePlaylistLink(btn.dataset.id);
        });
    });
    document.querySelectorAll('.playlist-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPlaylistModal(btn.dataset.id);
        });
    });
    document.querySelectorAll('.playlist-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('¿Eliminar playlist?')) {
                playlists = playlists.filter(p => p.id !== btn.dataset.id);
                savePlaylists();
                renderPlaylistsList();
            }
        });
    });
}

function playPlaylist(playlistId) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.songIds.length === 0) return alert('Playlist vacía');
    const firstSong = songs.find(s => s.id === playlist.songIds[0]);
    if (firstSong) playSong(songs.findIndex(s => s.id === firstSong.id));
}

function openPlaylistModal(playlistId = null) {
    const modalDiv = document.getElementById('playlist-modal');
    if (!modalDiv) {
        console.error('Modal no encontrado');
        return;
    }
    
    const nameInput = document.getElementById('playlist-name');
    const availableDiv = document.getElementById('available-songs');
    const titleElem = document.getElementById('playlist-modal-title');
    const deleteBtn = document.getElementById('delete-playlist-btn');
    const closeBtn = document.getElementById('close-playlist-modal');
    const saveBtn = document.getElementById('save-playlist-btn');
    
    if (!nameInput || !availableDiv || !titleElem) {
        console.error('Elementos del modal no encontrados');
        return;
    }
    
    let playlist = null;
    if (playlistId) {
        playlist = playlists.find(p => p.id === playlistId);
        if (playlist) {
            titleElem.textContent = `✏️ Editar: ${playlist.name}`;
            nameInput.value = playlist.name;
            deleteBtn.style.display = 'block';
        }
    } else {
        titleElem.textContent = '📋 Crear Playlist';
        nameInput.value = '';
        deleteBtn.style.display = 'none';
    }
    
    // Mostrar canciones disponibles
    availableDiv.innerHTML = songs.map(s => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px; margin:5px 0; background:rgba(0,0,0,0.3); border-radius:8px">
            <input type="checkbox" value="${s.id}" ${playlist && playlist.songIds.includes(s.id) ? 'checked' : ''}>
            <label style="flex:1; cursor:pointer;">${escapeHtml(s.title)} - ${escapeHtml(s.artist)}</label>
        </div>
    `).join('');
    
    modalDiv.style.display = 'flex';
    
    // Función para guardar
    const saveHandler = () => {
        const name = nameInput.value.trim();
        if (!name) return alert('Nombre requerido');
        const selected = [...document.querySelectorAll('#available-songs input:checked')].map(cb => parseInt(cb.value));
        if (playlist) {
            playlist.name = name;
            playlist.songIds = selected;
        } else {
            playlists.push({ id: Date.now().toString(), name: name, songIds: selected });
        }
        savePlaylists();
        renderPlaylistsList();
        modalDiv.style.display = 'none';
    };
    
    // Función para eliminar
    const deleteHandler = () => {
        if (playlist && confirm(`¿Eliminar la playlist "${playlist.name}"?`)) {
            playlists = playlists.filter(p => p.id !== playlist.id);
            savePlaylists();
            renderPlaylistsList();
            modalDiv.style.display = 'none';
        }
    };
    
    // Función para cerrar
    const closeHandler = () => {
        modalDiv.style.display = 'none';
    };
    
    // Remover event listeners anteriores para evitar duplicados
    saveBtn.removeEventListener('click', saveHandler);
    deleteBtn.removeEventListener('click', deleteHandler);
    closeBtn.removeEventListener('click', closeHandler);
    
    // Agregar event listeners
    saveBtn.addEventListener('click', saveHandler);
    deleteBtn.addEventListener('click', deleteHandler);
    closeBtn.addEventListener('click', closeHandler);
    
    // Cerrar al hacer clic fuera
    modalDiv.onclick = (e) => {
        if (e.target === modalDiv) modalDiv.style.display = 'none';
    };
}

function copyPlaylistText(playlistId) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    const text = playlist.songIds.map(id => {
        const s = songs.find(s => s.id === id);
        return `${s?.title} - ${s?.artist}`;
    }).join('\n');
    navigator.clipboard.writeText(`🎵 ${playlist.name}\n${text}`);
    alert('📋 Playlist copiada');
}
// ==================== PESTAÑAS ====================
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
            if (tab.dataset.tab === 'playlists') renderPlaylistsList();
        });
    });
}

// ==================== EVENTOS ====================
playPauseBtn.addEventListener('click', playPause);
nextBtn.addEventListener('click', nextSong);
prevBtn.addEventListener('click', prevSong);

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        progressBar.value = (audio.currentTime / audio.duration) * 100;
        currentTimeSpan.textContent = formatTime(audio.currentTime);
        durationSpan.textContent = formatTime(audio.duration);
    }
});

progressBar.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (progressBar.value / 100) * audio.duration;
});

volumeControl.addEventListener('input', () => audio.volume = volumeControl.value);

addMusicBtn.addEventListener('click', () => {
    if (confirm('📂 ¿Archivo local? (Aceptar)\n🌐 ¿URL? (Cancelar)')) {
        fileInput.click();
    } else {
        modal.style.display = 'flex';
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) uploadFile(e.target.files[0]);
    fileInput.value = '';
});

closeModal.addEventListener('click', () => modal.style.display = 'none');
window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

// ==================== CONFIRMAR DESCARGA (DETECTA YOUTUBE AUTOMÁTICAMENTE) ====================
confirmDownload.addEventListener('click', () => {
    const url = downloadUrl.value.trim();
    const title = songTitleInput.value.trim();
    const artist = artistInput.value.trim();
    
    if (!url) {
        alert('Ingresa una URL');
        return;
    }
    
    // Detectar si es YouTube
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
    
    if (isYoutube) {
        downloadFromYouTube(url, title, artist);
    } else {
        downloadFromUrl(url, title, artist);
    }
    
    downloadUrl.value = '';
    songTitleInput.value = '';
    artistInput.value = '';
});

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
}

// ==================== INICIALIZAR ====================
(async function start() {
    await initDB();
    if (db) {
        await loadSongs();
        loadPlaylists();
        initTabs();
        document.getElementById('create-playlist-btn')?.addEventListener('click', () => openPlaylistModal());
        console.log('✅ MusicBox listo');
    }
})();