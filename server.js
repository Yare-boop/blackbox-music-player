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

// ==================== ENDPOINTS ====================

// Endpoint para verificar estado del servidor
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Endpoint proxy para descargar música directa
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

// ==================== YOUTUBE DOWNLOADER ====================

// Crear carpeta temporal
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
    console.log('📁 Carpeta temporal creada:', TEMP_DIR);
}

// Verificar si es URL de YouTube
function isYouTubeUrl(url) {
    const patterns = [
        /youtube\.com\/watch\?v=/,
        /youtu\.be\//,
        /youtube\.com\/shorts\//,
        /youtube\.com\/embed\//
    ];
    return patterns.some(p => p.test(url));
}

// Descargar audio de YouTube
function downloadYouTubeAudio(url, callback) {
    const tempId = crypto.randomBytes(8).toString('hex');
    const outputTemplate = path.join(TEMP_DIR, `${tempId}_%(title)s.%(ext)s`);
    
    console.log(`🎬 Descargando YouTube: ${url}`);
    
    const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" "${url}"`;
    
    exec(command, { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
            console.error('❌ yt-dlp error:', error.message);
            callback(error, null);
            return;
        }
        
        // Buscar el archivo MP3
        const files = fs.readdirSync(TEMP_DIR);
        const mp3File = files.find(f => f.startsWith(tempId) && f.endsWith('.mp3'));
        
        if (!mp3File) {
            callback(new Error('No se encontró el archivo MP3'), null);
            return;
        }
        
        const mp3Path = path.join(TEMP_DIR, mp3File);
        console.log(`✅ Audio descargado: ${mp3File}`);
        
        fs.readFile(mp3Path, (err, data) => {
            try { fs.unlinkSync(mp3Path); } catch(e) {}
            
            if (err) {
                callback(err, null);
            } else {
                let title = mp3File.replace(`${tempId}_`, '').replace('.mp3', '');
                callback(null, { data, title });
            }
        });
    });
}

// Endpoint para YouTube
app.get('/api/download-youtube', (req, res) => {
    const url = req.query.url;
    
    console.log(`🎬 Endpoint YouTube llamado con URL: ${url}`);
    
    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }
    
    if (!isYouTubeUrl(url)) {
        return res.status(400).json({ error: 'No es una URL válida de YouTube' });
    }
    
    downloadYouTubeAudio(url, (error, result) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Audio-Title', encodeURIComponent(result.title));
        res.send(result.data);
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('🎵 MusicBox - Proxy Server');
    console.log('=================================');
    console.log(`✅ Servidor en: http://localhost:${PORT}`);
    console.log(`🎬 Endpoint YouTube: http://localhost:${PORT}/api/download-youtube`);
    console.log('=================================\n');
});