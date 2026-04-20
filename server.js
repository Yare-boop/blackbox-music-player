const express = require('express');
const cors    = require('cors');
const { exec } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'blackboxapp'))); // carpeta del frontend

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ── Carpeta temporal ──────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Limpiar temporales cada 5 min
setInterval(() => {
    try {
        const now = Date.now();
        fs.readdirSync(TEMP_DIR).forEach(f => {
            const fp = path.join(TEMP_DIR, f);
            if (now - fs.statSync(fp).mtimeMs > 300000) {
                fs.unlinkSync(fp);
            }
        });
    } catch(e) {}
}, 300000);

// ── Opciones de yt-dlp ────────────────────────────────────────
// User-Agent de Android para evitar bloqueos de YouTube
const YT_UA = [
    '--user-agent "Mozilla/5.0 (Linux; Android 13; Pixel 7)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Chrome/120.0.0.0 Mobile Safari/537.36"'
].join(' ');

const YT_EXTRA = [
    '--no-check-certificate',
    '--age-limit 99',
    '--extractor-args "youtube:player_client=android,web"',
    YT_UA
].join(' ');

// ── Health check ──────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', message: '⚫ BlackBox Termux activo' });
});

// ── Ruta principal → sirve el frontend ───────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'blackboxapp', 'index.html'));
});

// ── /api/playlist-info → metadatos sin descargar ─────────────
app.post('/api/playlist-info', (req, res) => {
    const url = (req.body.url || '').trim();
    if (!url) return res.status(400).json({ error: 'No se proporcionó URL' });

    console.log(`📋 Obteniendo info de playlist: ${url}`);

    const cmd = `yt-dlp --flat-playlist --dump-json ${YT_EXTRA} "${url}"`;

    exec(cmd, { maxBuffer: 20 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('❌ playlist-info error:', err.message);
            return res.status(500).json({ error: err.message.slice(0, 200) });
        }

        const lines = stdout.trim().split('\n').filter(Boolean);
        const songs = [];
        let playlistName = 'Playlist';

        for (const line of lines) {
            try {
                const d = JSON.parse(line);
                // El primer objeto puede tener el título de la playlist
                if (d.playlist_title) playlistName = d.playlist_title;

                const vidId = d.id || '';
                if (!vidId) continue;

                const vidUrl = vidId.length === 11
                    ? `https://www.youtube.com/watch?v=${vidId}`
                    : (d.url || vidId);

                songs.push({
                    id:       vidId,
                    title:    d.title || 'Sin título',
                    url:      vidUrl,
                    duration: d.duration || 0,
                });
            } catch(e) {}
        }

        console.log(`✅ ${songs.length} canciones encontradas`);
        res.json({ name: playlistName, total: songs.length, songs });
    });
});

// ── /api/download → descarga una canción y la envía al browser ─
app.post('/api/download', (req, res) => {
    const url = (req.body.url || '').trim();
    if (!url) return res.status(400).json({ error: 'No se proporcionó URL' });

    const tempId     = crypto.randomBytes(8).toString('hex');
    const outputTmpl = path.join(TEMP_DIR, `${tempId}_%(title)s.%(ext)s`);

    console.log(`🎵 Descargando: ${url}`);

    const cmd = [
        'yt-dlp',
        '-x --audio-format mp3 --audio-quality 192K',
        `--no-playlist`,
        YT_EXTRA,
        `-o "${outputTmpl}"`,
        `"${url}"`
    ].join(' ');

    exec(cmd, { maxBuffer: 200 * 1024 * 1024, timeout: 300000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('❌ download error:', err.message.slice(0, 300));

            // Mensajes de error claros
            if (err.message.includes('Sign in') || err.message.includes('bot')) {
                return res.status(500).json({ error: 'YouTube bloqueó la descarga (bot detection)' });
            }
            if (err.message.includes('unavailable') || err.message.includes('Private')) {
                return res.status(400).json({ error: 'Video no disponible o privado' });
            }
            return res.status(500).json({ error: err.message.slice(0, 150) });
        }

        // Buscar el archivo generado
        let audioFile = null;
        try {
            const files = fs.readdirSync(TEMP_DIR);
            for (const ext of ['.mp3', '.m4a', '.ogg', '.opus', '.webm']) {
                const f = files.find(f => f.startsWith(tempId) && f.endsWith(ext));
                if (f) { audioFile = path.join(TEMP_DIR, f); break; }
            }
        } catch(e) {}

        if (!audioFile || !fs.existsSync(audioFile)) {
            return res.status(500).json({ error: 'No se generó el archivo de audio' });
        }

        // Extraer título del nombre de archivo
        const rawName  = path.basename(audioFile, path.extname(audioFile));
        const title    = rawName.replace(`${tempId}_`, '').trim() || 'cancion';
        const safeTitle = title.replace(/[^\w\s\-áéíóúÁÉÍÓÚñÑ]/g, '').slice(0, 80).trim();

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
        res.setHeader('X-Song-Title', safeTitle);
        res.setHeader('Access-Control-Expose-Headers', 'X-Song-Title');

        const stream = fs.createReadStream(audioFile);
        stream.pipe(res);
        stream.on('end', () => {
            try { fs.unlinkSync(audioFile); } catch(e) {}
        });
        stream.on('error', (e) => {
            console.error('Stream error:', e.message);
            try { fs.unlinkSync(audioFile); } catch(e) {}
        });
    });
});

// ── Iniciar ───────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n================================');
    console.log('  ⚫  B L A C K B O X');
    console.log('================================');
    console.log(`✅ http://localhost:${PORT}`);
    console.log(`📡 http://TU_IP_LOCAL:${PORT}`);
    console.log('================================\n');
});