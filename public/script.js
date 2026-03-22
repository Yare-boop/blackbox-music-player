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

// ==================== THROTTLE PARA RENDIMIENTO ====================
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

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

// ==================== RENDER LISTA OPTIMIZADO ====================
let renderTimeout = null;

async function renderSongsList() {
    if (songs.length === 0) {
        playlistEl.innerHTML = '<li class="empty-playlist">🎵 No hay canciones. Agrega música</li>';
        songTitle.textContent = 'No hay canciones';
        songArtist.textContent = 'Agrega música';
        return;
    }
    
    if (renderTimeout) clearTimeout(renderTimeout);
    
    renderTimeout = setTimeout(() => {
        const fragment = document.createDocumentFragment();
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        
        const displaySongs = songs;
        
        displaySongs.forEach(s => {
            const li = document.createElement('li');
            li.dataset.id = s.id;
            li.style.cssText = 'padding:12px; margin-bottom:8px; background:rgba(0,0,0,0.4); border-radius:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center';
            li.innerHTML = `
                <div style="flex:1">
                    <div><strong>${escapeHtml(s.title)}</strong></div>
                    <div style="font-size:0.8rem; color:#c9a87b">${escapeHtml(s.artist)}</div>
                    <div style="font-size:0.7rem; color:#888">${(s.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <div style="display:flex; gap:5px">
                    <button class="lyrics-btn" data-id="${s.id}" style="background:rgba(100,100,200,0.3); border:1px solid #6b9b6b; color:#a8c8a8; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem" title="Ver letras">📖</button>
                    <button class="del-btn" data-id="${s.id}" style="background:#8b3a2a; border:none; color:white; padding:5px 10px; border-radius:5px; cursor:pointer">🗑️</button>
                </div>
            `;
            ul.appendChild(li);
        });
        
        fragment.appendChild(ul);
        playlistEl.innerHTML = '';
        playlistEl.appendChild(fragment);
        
        // Delegación de eventos (mejor rendimiento)
        playlistEl.removeEventListener('click', handlePlaylistClick);
        playlistEl.addEventListener('click', handlePlaylistClick);
    }, 50);
}

// Manejador de eventos delegado
function handlePlaylistClick(e) {
    const delBtn = e.target.closest('.del-btn');
    const lyricsBtn = e.target.closest('.lyrics-btn');
    const li = e.target.closest('li');
    
    if (delBtn) {
        e.stopPropagation();
        const id = parseInt(delBtn.dataset.id);
        if (confirm('¿Eliminar?')) {
            deleteSong(id).then(() => loadSongs());
        }
    } else if (lyricsBtn) {
        e.stopPropagation();
        const id = parseInt(lyricsBtn.dataset.id);
        const song = songs.find(s => s.id === id);
        if (song) showLyricsModal(song);
    } else if (li) {
        const id = parseInt(li.dataset.id);
        const index = songs.findIndex(s => s.id === id);
        if (index !== -1) playSong(index);
    }
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

// ==================== DESCARGA CON PROGRESO ====================
function updateDownloadProgress(percent) {
    const progressFill = document.getElementById('download-progress-fill');
    const progressPercent = document.getElementById('download-progress-percent');
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
    confirmDownload.textContent = `Descargando ${Math.round(percent)}%`;
}

async function downloadWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        
        xhr.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress((event.loaded / event.total) * 100);
            }
        };
        
        xhr.onload = () => {
            if (xhr.status === 200) {
                resolve(xhr.response);
            } else {
                reject(new Error(`HTTP ${xhr.status}`));
            }
        };
        
        xhr.onerror = () => reject(new Error('Error de red'));
        xhr.send();
    });
}

async function downloadFromUrl(url, title, artist) {
    if (!url) return alert('Ingresa una URL');
    try {
        confirmDownload.disabled = true;
        const progressContainer = document.getElementById('download-progress-container');
        if (progressContainer) progressContainer.style.display = 'block';
        
        const blob = await downloadWithProgress(url, (percent) => {
            updateDownloadProgress(percent);
        });
        
        await saveSong(title || 'Descargada', artist || 'Web', blob);
        await loadSongs();
        modal.style.display = 'none';
        alert('✅ Descarga completada');
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        confirmDownload.disabled = false;
        confirmDownload.textContent = 'Descargar';
        const progressContainer = document.getElementById('download-progress-container');
        if (progressContainer) progressContainer.style.display = 'none';
        updateDownloadProgress(0);
    }
}

async function downloadFromYouTube(url, title, artist) {
    if (!url) return alert('Ingresa una URL de YouTube');
    try {
        confirmDownload.disabled = true;
        const progressContainer = document.getElementById('download-progress-container');
        if (progressContainer) progressContainer.style.display = 'block';
        
        const response = await fetch(`/api/download-youtube?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Error en descarga de YouTube');
        
        const reader = response.body.getReader();
        const contentLength = parseInt(response.headers.get('Content-Length'));
        let receivedLength = 0;
        const chunks = [];
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            
            if (contentLength) {
                const percent = (receivedLength / contentLength) * 100;
                updateDownloadProgress(percent);
            }
        }
        
        let blob = new Blob(chunks);
        blob = new Blob([blob], { type: 'audio/mpeg' });
        
        await saveSong(title || 'Canción de YouTube', artist || 'YouTube', blob);
        await loadSongs();
        modal.style.display = 'none';
        alert('✅ Descarga completada');
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        confirmDownload.disabled = false;
        confirmDownload.textContent = 'Descargar';
        const progressContainer = document.getElementById('download-progress-container');
        if (progressContainer) progressContainer.style.display = 'none';
        updateDownloadProgress(0);
    }
}

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

// ==================== SUBIR ARCHIVO ====================
async function uploadFile(file) {
    if (!file.type.includes('audio')) return alert('Selecciona un archivo de audio');
    const title = file.name.replace(/\.[^/.]+$/, "");
    const blob = await file.arrayBuffer().then(b => new Blob([b], { type: file.type }));
    await saveSong(title, 'Local', blob);
    await loadSongs();
    alert(`✅ ${title} agregada`);
}

// ==================== COMPARTIR ====================
async function sharePlaylistLink(playlistId) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    
    const songList = playlist.songIds.map(id => {
        const song = songs.find(s => s.id === id);
        return song ? `🎵 ${song.title} - ${song.artist}` : '';
    }).filter(Boolean).join('\n');
    
    const shareText = `📀 Mi playlist: ${playlist.name}\n\n${songList}\n\n🎧 Creado con MusicBox`;
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: `Playlist: ${playlist.name}`,
                text: shareText,
            });
            return;
        } catch (err) {
            console.log('Compartir cancelado');
        }
    }
    
    showShareModal(playlist.name, shareText);
}

function showShareModal(playlistName, shareText) {
    const existingModal = document.getElementById('custom-share-modal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'custom-share-modal';
    modalDiv.className = 'modal';
    modalDiv.style.display = 'flex';
    modalDiv.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <span class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>📤 Compartir: ${escapeHtml(playlistName)}</h3>
            <textarea id="share-text" readonly style="width:100%; height:150px; background:#1a1a2e; color:#e8d5b5; border:1px solid #9b7b4c; border-radius:8px; padding:10px; margin:15px 0;">${escapeHtml(shareText)}</textarea>
            <button id="copy-share-btn" style="background:#6b9b6b; color:white; border:none; padding:10px 20px; border-radius:8px; cursor:pointer; width:100%">📋 Copiar al portapapeles</button>
        </div>
    `;
    document.body.appendChild(modalDiv);
    
    document.getElementById('copy-share-btn')?.addEventListener('click', async () => {
        const textarea = document.getElementById('share-text');
        await navigator.clipboard.writeText(textarea.value);
        alert('✅ Playlist copiada al portapapeles');
        modalDiv.remove();
    });
    
    modalDiv.addEventListener('click', (e) => {
        if (e.target === modalDiv) modalDiv.remove();
    });
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
    
    availableDiv.innerHTML = songs.map(s => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px; margin:5px 0; background:rgba(0,0,0,0.3); border-radius:8px">
            <input type="checkbox" value="${s.id}" ${playlist && playlist.songIds.includes(s.id) ? 'checked' : ''}>
            <label style="flex:1; cursor:pointer;">${escapeHtml(s.title)} - ${escapeHtml(s.artist)}</label>
        </div>
    `).join('');
    
    modalDiv.style.display = 'flex';
    
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
    
    const deleteHandler = () => {
        if (playlist && confirm(`¿Eliminar la playlist "${playlist.name}"?`)) {
            playlists = playlists.filter(p => p.id !== playlist.id);
            savePlaylists();
            renderPlaylistsList();
            modalDiv.style.display = 'none';
        }
    };
    
    const closeHandler = () => {
        modalDiv.style.display = 'none';
    };
    
    saveBtn.removeEventListener('click', saveHandler);
    deleteBtn.removeEventListener('click', deleteHandler);
    closeBtn.removeEventListener('click', closeHandler);
    
    saveBtn.addEventListener('click', saveHandler);
    deleteBtn.addEventListener('click', deleteHandler);
    closeBtn.addEventListener('click', closeHandler);
    
    modalDiv.onclick = (e) => {
        if (e.target === modalDiv) modalDiv.style.display = 'none';
    };
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

audio.addEventListener('timeupdate', throttle(() => {
    if (audio.duration) {
        progressBar.value = (audio.currentTime / audio.duration) * 100;
        currentTimeSpan.textContent = formatTime(audio.currentTime);
        durationSpan.textContent = formatTime(audio.duration);
    }
}, 100));

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

confirmDownload.addEventListener('click', () => {
    const url = downloadUrl.value.trim();
    const title = songTitleInput.value.trim();
    const artist = artistInput.value.trim();
    
    if (!url) {
        alert('Ingresa una URL');
        return;
    }
    
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

// ==================== DESCARGAR PLAYLIST COMPLETA ====================
async function downloadPlaylist(playlistUrl, playlistName) {
    if (!playlistUrl) return alert('Ingresa una URL de playlist de YouTube');
    
    const progressContainer = document.getElementById('playlist-progress-container');
    const progressFill = document.getElementById('playlist-progress-fill');
    const progressPercent = document.getElementById('playlist-progress-percent');
    const currentSongSpan = document.getElementById('playlist-current-song');
    
    try {
        if (progressContainer) progressContainer.style.display = 'block';
        
        // 1. Obtener lista de canciones del servidor
        currentSongSpan.textContent = '📀 Obteniendo lista de canciones...';
        const response = await fetch(`/api/get-playlist-songs?url=${encodeURIComponent(playlistUrl)}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error al obtener playlist');
        }
        
        const playlistData = await response.json();
        const songs = playlistData.songs;
        const total = songs.length;
        
        if (total === 0) {
            throw new Error('La playlist está vacía');
        }
        
        let downloaded = 0;
        let failed = 0;
        
        // 2. Descargar canción por canción
        for (let i = 0; i < songs.length; i++) {
            const song = songs[i];
            const percent = ((i + 1) / total) * 100;
            
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${Math.round(percent)}% (${i+1}/${total})`;
            if (currentSongSpan) currentSongSpan.textContent = `🎵 Descargando: ${song.title}`;
            
            try {
                // Descargar canción
                const downloadResponse = await fetch(`/api/download-youtube?url=${encodeURIComponent(song.url)}`);
                
                if (!downloadResponse.ok) {
                    throw new Error(`Error descargando ${song.title}`);
                }
                
                let blob = await downloadResponse.blob();
                blob = new Blob([blob], { type: 'audio/mpeg' });
                
                // Extraer artista (si está en el título)
                let artist = 'YouTube';
                let title = song.title;
                
                // Intentar separar artista - título (formato común: "Artista - Título")
                if (song.title.includes(' - ')) {
                    const parts = song.title.split(' - ');
                    artist = parts[0];
                    title = parts.slice(1).join(' - ');
                }
                
                await saveSong(title, artist, blob);
                downloaded++;
                
                // Pequeña pausa para no sobrecargar
                await new Promise(resolve => setTimeout(resolve, 300));
                
            } catch (songError) {
                console.error(`❌ Error con ${song.title}:`, songError);
                failed++;
            }
        }
        
        await loadSongs();
        
        const finalName = playlistName || playlistData.name || 'Playlist';
        alert(`✅ Playlist "${finalName}" completada!\n📀 Descargadas: ${downloaded}\n❌ Fallidas: ${failed}`);
        
        // Cerrar modal
        const modal = document.getElementById('playlist-download-modal');
        if (modal) modal.style.display = 'none';
        
    } catch (error) {
        alert('Error: ' + error.message);
        console.error(error);
    } finally {
        if (progressContainer) progressContainer.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';
    }
}

// ==================== EVENTOS PLAYLIST ====================
const addPlaylistBtn = document.getElementById('add-playlist-btn');
const playlistModal = document.getElementById('playlist-download-modal');
const closePlaylistModal = document.getElementById('close-playlist-modal');
const confirmPlaylistDownload = document.getElementById('confirm-playlist-download');
const playlistUrlInput = document.getElementById('playlist-url');
const playlistNameInput = document.getElementById('playlist-name-input');

if (addPlaylistBtn) {
    addPlaylistBtn.addEventListener('click', () => {
        if (playlistModal) playlistModal.style.display = 'flex';
    });
}

if (closePlaylistModal) {
    closePlaylistModal.addEventListener('click', () => {
        if (playlistModal) playlistModal.style.display = 'none';
    });
}

if (confirmPlaylistDownload) {
    confirmPlaylistDownload.addEventListener('click', async () => {
        const url = playlistUrlInput.value.trim();
        const name = playlistNameInput.value.trim();
        
        if (!url) {
            alert('Ingresa una URL de playlist de YouTube');
            return;
        }
        
        await downloadPlaylist(url, name);
        
        playlistUrlInput.value = '';
        playlistNameInput.value = '';
    });
}

// Cerrar modal al hacer clic fuera
window.addEventListener('click', (e) => {
    if (e.target === playlistModal) {
        if (playlistModal) playlistModal.style.display = 'none';
    }
});

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