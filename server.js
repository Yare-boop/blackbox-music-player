const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Logging de peticiones
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Crear carpeta temporal
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
    console.log('📁 Carpeta temporal creada:', TEMP_DIR);
}

// ==================== UTILIDADES ====================

function isYouTubeUrl(url) {
    const patterns = [
        /youtube\.com\/watch\?v=/,
        /youtu\.be\//,
        /youtube\.com\/shorts\//,
        /youtube\.com\/embed\//,
        /youtube\.com\/playlist\?list=/  // Nuevo: soporte para playlists
    ];
    return patterns.some(p => p.test(url));
}

function isSpotifyUrl(url) {
    return url.includes('spotify.com/') && (url.includes('/playlist/') || url.includes('/album/'));
}

function isAppleMusicUrl(url) {
    return url.includes('music.apple.com/');
}

// ==================== OBTENER PLAYLIST DE YOUTUBE ====================
function getYouTubePlaylistSongs(playlistUrl) {
    return new Promise((resolve, reject) => {
        console.log(`📀 Obteniendo playlist de YouTube: ${playlistUrl}`);
        
        // Usar yt-dlp para obtener la lista de canciones
        const command = `yt-dlp --flat-playlist --dump-json "${playlistUrl}"`;
        
        exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error obteniendo playlist:', error.message);
                reject(error);
                return;
            }
            
            const lines = stdout.trim().split('\n').filter(line => line.trim());
            const songs = [];
            
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.title && data.url) {
                        songs.push({
                            title: data.title,
                            url: data.url,
                            duration: data.duration || 0
                        });
                    }
                } catch (e) {
                    console.error('Error parseando:', e.message);
                }
            }
            
            console.log(`✅ Encontradas ${songs.length} canciones en la playlist`);
            resolve(songs);
        });
    });
}

// ==================== DESCARGAR CANCIÓN INDIVIDUAL ====================
function downloadYouTubeSong(url, songTitle = null) {
    return new Promise((resolve, reject) => {
        const tempId = crypto.randomBytes(8).toString('hex');
        const outputTemplate = path.join(TEMP_DIR, `${tempId}_%(title)s.%(ext)s`);
        
        console.log(`🎬 Descargando canción: ${songTitle || url}`);
        
        const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" "${url}"`;
        
        exec(command, { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            
            // Buscar el archivo MP3
            const files = fs.readdirSync(TEMP_DIR);
            const mp3File = files.find(f => f.startsWith(tempId) && f.endsWith('.mp3'));
            
            if (!mp3File) {
                reject(new Error('No se encontró el archivo MP3'));
                return;
            }
            
            const mp3Path = path.join(TEMP_DIR, mp3File);
            
            fs.readFile(mp3Path, (err, data) => {
                // Limpiar archivo temporal
                try { fs.unlinkSync(mp3Path); } catch(e) {}
                
                if (err) {
                    reject(err);
                } else {
                    let title = mp3File.replace(`${tempId}_`, '').replace('.mp3', '');
                    resolve({ data, title });
                }
            });
        });
    });
}

// ==================== ENDPOINTS ====================

// Estado del servidor
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Descarga directa desde URL
app.get('/api/download', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }
    
    console.log(`🎵 Descargando directo: ${url}`);
    
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 60000
        });
        
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        response.data.pipe(res);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Descargar canción de YouTube individual
app.get('/api/download-youtube', (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }
    
    if (!isYouTubeUrl(url)) {
        return res.status(400).json({ error: 'No es una URL válida de YouTube' });
    }
    
    downloadYouTubeSong(url, null).then(({ data, title }) => {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Audio-Title', encodeURIComponent(title));
        res.send(data);
    }).catch(error => {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: error.message });
    });
});

// NUEVO: Obtener canciones de una playlist/álbum
app.get('/api/get-playlist-songs', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }
    
    console.log(`📀 Solicitando playlist: ${url}`);
    
    try {
        let songs = [];
        let playlistName = '';
        
        if (isYouTubeUrl(url)) {
            songs = await getYouTubePlaylistSongs(url);
            playlistName = 'Playlist de YouTube';
        } 
        else if (isSpotifyUrl(url)) {
            // Para Spotify necesitarías API key
            return res.status(501).json({ 
                error: 'Spotify requiere API key. Por ahora solo soporta YouTube',
                suggestion: 'Convierte tu playlist de Spotify a YouTube con herramientas como "Spotify to YouTube"'
            });
        }
        else {
            return res.status(400).json({ error: 'URL no soportada. Solo YouTube por ahora' });
        }
        
        if (songs.length === 0) {
            return res.status(404).json({ error: 'No se encontraron canciones en la playlist' });
        }
        
        res.json({
            name: playlistName,
            url: url,
            totalSongs: songs.length,
            songs: songs
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// NUEVO: Descargar playlist completa (una por una)
app.post('/api/download-playlist', async (req, res) => {
    const { url, songUrls } = req.body;
    
    if (!url && !songUrls) {
        return res.status(400).json({ error: 'Se requiere URL de playlist o lista de canciones' });
    }
    
    // Esta es una versión simplificada
    // En producción, mejor descargar una por una desde el frontend
    res.json({ message: 'Usa /api/get-playlist-songs primero, luego descarga cada canción individualmente' });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('🎵 BlackBox - Music Downloader');
    console.log('=================================');
    console.log(`✅ Servidor en: http://localhost:${PORT}`);
    console.log(`🎬 YouTube: http://localhost:${PORT}/api/download-youtube`);
    console.log(`📀 Playlists: http://localhost:${PORT}/api/get-playlist-songs`);
    console.log('=================================\n');
});