'use strict';

// ── Polyfill crypto untuk Node < 19 ───────────────
if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}

console.clear();
console.log('🐟 Fisch Bot — Starting...\n');

// ── Dependencies ───────────────────────────────────
const config  = require('./settings/config');
const pino    = require('pino');
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');
const { Boom } = require('@hapi/boom');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidDecode,
    isJidBroadcast,
    proto,
    delay,
    downloadContentFromMessage,
    makeCacheableSignalKeyStore,
    Browsers,
} = require('@whiskeysockets/baileys');

const FileType = require('file-type');
const { color }   = require('./w-shennmine/lib/color');
const { smsg, sleep, getBuffer } = require('./w-shennmine/lib/myfunction');
const { writeExifImg, addExif }  = require('./w-shennmine/lib/exif');

// ── Validasi config ────────────────────────────────
if (!config.mongoSrv || config.mongoSrv.includes('USER:PASS')) {
    console.error('❌ mongoSrv belum diisi di settings/config.js!\n');
    process.exit(1);
}

// ── Logger silent ──────────────────────────────────
const logger = pino({ level: 'silent' });

// ── Simple in-memory store ─────────────────────────
function createStore() {
    const msgs = {}, contacts = {};
    return {
        msgs, contacts,
        bind(ev) {
            ev.on('messages.upsert', ({ messages }) => {
                for (const m of messages) {
                    if (!m.key?.remoteJid || !m.key?.id) continue;
                    if (!msgs[m.key.remoteJid]) msgs[m.key.remoteJid] = {};
                    msgs[m.key.remoteJid][m.key.id] = m;
                }
            });
            ev.on('contacts.upsert', cs => cs.forEach(c => { contacts[c.id] = c; }));
        },
        loadMessage: (jid, id) => msgs[jid]?.[id] || null
    };
}

// ── Readline helper ────────────────────────────────
const ask = (prompt) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(color(prompt, 'cyan'), ans => { rl.close(); res(ans.trim()); }));
};

// ── Pairing code helper ────────────────────────────
async function doPairing(client) {
    // Sudah registered — skip
    if (client.authState.creds.registered) return;

    let phone = config.owner || '';

    // Tanya nomor kalau belum ada / di terminal mode
    if (config.status.terminal || !phone) {
        phone = await ask('📱 Masukkan nomor WA (format 62xxx, tanpa +): ');
    }

    // Bersihkan — hanya angka
    phone = phone.replace(/\D/g, '').trim();

    if (!phone || phone.length < 8) {
        console.log('❌ Nomor tidak valid! Restart dan coba lagi.');
        process.exit(1);
    }

    // Tunggu socket siap sebelum request pairing
    await delay(3000);

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const code = await client.requestPairingCode(phone);
            const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
            console.log('\n╔══════════════════════════════╗');
            console.log(`║  🔑 PAIRING CODE: ${formatted.padEnd(11)}║`);
            console.log('╚══════════════════════════════╝');
            console.log('👉 Buka WA → Linked Devices → Link with phone number\n');
            return; // sukses
        } catch (e) {
            const msg = e?.message || String(e);
            console.log(`⏳ Pairing attempt ${attempt}/5 gagal: ${msg}`);

            // Kalau error karena tidak terdaftar / bad state → hapus session
            if (msg.includes('not registered') || msg.includes('invalid')) {
                const sessDir = path.resolve(`./${config.session}`);
                if (fs.existsSync(sessDir)) {
                    fs.rmSync(sessDir, { recursive: true, force: true });
                    console.log('🗑️  Session dihapus. Restart bot.');
                }
                process.exit(1);
            }

            if (attempt < 5) await delay(attempt * 5000);
            else {
                console.log('❌ Pairing gagal 5x. Hapus folder sessions/ lalu restart.');
                process.exit(1);
            }
        }
    }
}

// ── Main clientstart ───────────────────────────────
const clientstart = async () => {
    // Buat folder session kalau belum ada
    const sessDir = path.resolve(`./${config.session}`);
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });

    const store = createStore();
    const { state, saveCreds } = await useMultiFileAuthState(sessDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📦 Baileys v${version.join('.')} | Latest: ${isLatest}`);

    const client = makeWASocket({
        version,
        logger,
        printQRInTerminal:    !config.status.terminal,
        auth: {
            creds: state.creds,
            keys:  makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser:              Browsers.ubuntu('Chrome'),
        markOnlineOnConnect:  false,
        syncFullHistory:      false,
        generateHighQualityLinkPreview: false,  // matikan — penyebab not-acceptable
        connectTimeoutMs:     60_000,
        keepAliveIntervalMs:  25_000,
        retryRequestDelayMs:  3_000,
        maxMsgRetryCount:     2,                // kurangi retry biar tidak spam
        emitOwnEvents:        false,
        fireInitQueries:      true,
        shouldIgnoreJid:      jid => isJidBroadcast(jid),
        // patchMessageBeforeSending: strip contextInfo yang bisa bikin not-acceptable
        patchMessageBeforeSending: (msg) => {
            const requiresPatch = !!(
                msg.buttonsMessage ||
                msg.templateMessage ||
                msg.listMessage
            );
            if (requiresPatch) {
                msg = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} }, ...msg } } };
            }
            return msg;
        },
        getMessage: async (key) => {
            try {
                const msg = store.loadMessage(key.remoteJid, key.id);
                if (msg?.message) return msg.message;
            } catch (_) {}
            return undefined;
        }
    });

    // ── Pairing code (terminal mode) ─────────────────
    if (config.status.terminal && !client.authState.creds.registered) {
        await doPairing(client);
    }

    // ── Bind store & creds ────────────────────────────
    store.bind(client.ev);
    client.ev.on('creds.update', saveCreds);
    console.log('[WA] Socket dibuat, menunggu koneksi...');

    // Simpan creds tiap 30 detik, cegah corrupt saat kill proses
    let saveFailCount = 0;
    setInterval(async () => {
        try {
            await saveCreds();
            saveFailCount = 0;
        } catch (e) {
            saveFailCount++;
            console.error('[creds] save gagal:', e.message);
            // Jika gagal 5x berturut-turut = session mungkin corrupt
            if (saveFailCount >= 5) {
                console.log('[creds] Session mungkin corrupt — reconnect...');
                saveFailCount = 0;
                try { client.end(new Error('creds-corrupt')); } catch (_) {}
            }
        }
    }, 30_000);

    // ── Connection update ─────────────────────────────
    client.ev.on('connection.update', (update) => {
        const { konek } = require('./w-shennmine/lib/connection/connect');
        konek({ client, update, clientstart, DisconnectReason, Boom });
    });

    // ── Pesan masuk ───────────────────────────────────
    client.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek?.message) return;

            // Unwrap ephemeral
            if (Object.keys(mek.message)[0] === 'ephemeralMessage') {
                mek.message = mek.message.ephemeralMessage.message;
            }

            // Auto-react status
            if (config.status.reactsw && mek.key?.remoteJid === 'status@broadcast') {
                const emojis = ['😘','😂','😍','🙏','😜','😎','🔥','❤️','👏','🎉'];
                await client.readMessages([mek.key]);
                await client.sendMessage('status@broadcast', {
                    react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: mek.key }
                }, { statusJidList: [mek.key.participant] }).catch(() => {});
            }

            // Public mode: kalau false, hanya fromMe yang diproses
            // TAPI tetap proses pesan di group agar bot bisa respon command
            if (config.status.public === false && !mek.key.fromMe && chatUpdate.type === 'notify') {
                const _isGroup = mek.key?.remoteJid?.endsWith('@g.us');
                if (!_isGroup) return; // block DM, tapi allow group
            }
            if (mek.key.id?.startsWith('SH3NN-') && mek.key.id.length === 12) return;

            const m = await smsg(client, mek, store);
            if (!m) return; // smsg bisa return null
            await require('./message')(client, m, chatUpdate, store);
        } catch (e) {
            if (!IGNORED.some(s => String(e).includes(s))) {
                console.error('[messages.upsert]', e.message);
            }
        }
    });

    // ── Contacts update ───────────────────────────────
    client.ev.on('contacts.update', update => {
        for (const c of update) {
            const id = client.decodeJid(c.id);
            if (store.contacts) store.contacts[id] = { id, name: c.notify };
        }
    });

    // ── Helper methods ────────────────────────────────
    client.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const d = jidDecode(jid) || {};
            return d.user && d.server ? `${d.user}@${d.server}` : jid;
        }
        return jid;
    };

    client.public = config.status.public;

    client.sendText = (jid, text, quoted = '', options = {}) =>
        client.sendMessage(jid, { text, ...options }, { quoted }).catch(e => console.error('[sendText]', e.message));

    client.deleteMessage = async (chatId, key) => {
        try { await client.sendMessage(chatId, { delete: key }); }
        catch (e) { console.error('[deleteMessage]', e.message); }
    };

    client.downloadMediaMessage = async (message) => {
        const mime = (message.msg || message).mimetype || '';
        const type = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(message, type);
        let buf = Buffer.from([]);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        return buf;
    };

    client.sendImageAsSticker = async (jid, pathOrBuf, quoted, options = {}) => {
        let buff = Buffer.isBuffer(pathOrBuf) ? pathOrBuf
            : /^data:.*\/.*?;base64,/i.test(pathOrBuf) ? Buffer.from(pathOrBuf.split`,`[1], 'base64')
            : /^https?:\/\//.test(pathOrBuf) ? await getBuffer(pathOrBuf)
            : fs.existsSync(pathOrBuf) ? fs.readFileSync(pathOrBuf) : Buffer.alloc(0);
        const buffer = (options.packname || options.author)
            ? await writeExifImg(buff, options) : await addExif(buff);
        await client.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
    };

    client.getFile = async (PATH, returnAsFilename) => {
        let res, filename;
        const data = Buffer.isBuffer(PATH) ? PATH
            : /^data:.*\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,`[1], 'base64')
            : /^https?:\/\//.test(PATH) ? await (res = await fetch(PATH)).arrayBuffer().then(Buffer.from)
            : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH))
            : typeof PATH === 'string' ? Buffer.from(PATH) : Buffer.alloc(0);
        if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer');
        const type = await FileType.fromBuffer(data) || { mime: 'application/octet-stream', ext: 'bin' };
        if (returnAsFilename && !filename) {
            const tmpDir = path.join(__dirname, 'tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            filename = path.join(tmpDir, `${Date.now()}.${type.ext}`);
            await fs.promises.writeFile(filename, data);
        }
        return { res, filename, ...type, data, deleteFile: () => filename && fs.promises.unlink(filename) };
    };

    return client;
};

// ── Noise/crypto error suppress list ──────────────
const IGNORED = [
    'Socket connection timeout', 'EKEYTYPE', 'item-not-found', 'rate-overlimit',
    'Connection Closed', 'Timed Out', 'Value not found',
    'No sessions', 'SessionError', 'session_cipher', 'Bad MAC',
    'decryptSenderKey', 'Message decryption failed',
    'buffer underflow', 'Invalid PreKey', 'No SenderKeyRecord',
    'SenderKeyDistributionMessage', 'Failed to decrypt', 'libsignal',
    'queue_job', 'asyncQueueExecutor', 'stream errored'
];

process.on('unhandledRejection', r => {
    if (!IGNORED.some(e => String(r).includes(e))) console.log('UnhandledRejection:', r);
});
process.on('uncaughtException', e => {
    if (!IGNORED.some(s => e.message?.includes(s))) console.error('UncaughtException:', e.message);
});
// Override console.error — hanya suppress noise, bukan semua error
const _oErr = console.error;
console.error = (m, ...a) => {
    if (typeof m === 'string' && IGNORED.some(e => m.includes(e))) return;
    // Pastikan error tetap tampil meski dalam format yang berbeda
    _oErr.apply(console, [m, ...a]);
};
// Jangan override console.log — biarkan semua log tampil
console.log('🔧 Error suppressor aktif (noise WA/signal disembunyikan)');

// ── Boot ───────────────────────────────────────────
clientstart().catch(e => {
    console.error('Fatal startup error:', e.message);
    process.exit(1);
});

// ── Hot-reload index.js (development only) ──────────
if (process.env.NODE_ENV === 'development') {
    const _self = require.resolve(__filename);
    fs.watchFile(_self, { interval: 2000, persistent: false }, () => {
        console.log('[index] Hot-reload...');
        delete require.cache[_self];
    });
}
