'use strict';

const config = {
    // ══════════════════════════════════════
    //   WAJIB DIISI SEBELUM MENJALANKAN BOT
    // ══════════════════════════════════════

    // Nomor WA owner (format internasional tanpa +, misal "6281234567890")
    owner: "6288989721627",
    botNumber: "",           // Nomor WA bot (opsional, untuk display)
    session: "sessions",    // Nama folder session baileys

    // MongoDB connection string
    // Format: mongodb+srv://USER:PASS@cluster.mongodb.net/?appName=APPNAME
    mongoSrv: "mongodb+srv://USER:PASS@cluster.mongodb.net/?appName=FischBot",  // ⚠️ WAJIB DIGANTI dengan MongoDB Atlas connection string kamu

    // Nomor admin bot (bisa lebih dari 1, tanpa @ dan tanpa +)
    admins: ["6288989721627"],  // Format sama dengan owner: 62xxx

    // ══════════════════════════════════════
    //   TELEGRAM BOT (OPSIONAL)
    // ══════════════════════════════════════
    telegram: {
        enabled: false,
        botToken: "ISI_TOKEN_DARI_BOTFATHER",
        channelId: ""           // ID channel log (kosongkan jika tidak dipakai)
    },

    // ══════════════════════════════════════
    //   INFO & TAMPILAN BOT
    // ══════════════════════════════════════
    version: "v1.2.0",
    settings: {
        title:       "🐟 Fisch Bot",
        packname:    "Fisch",
        description: "Bot Fisch WA — by Manzxy",
        author:      "Manzxy",
        footer:      "🎣 Fisch Bot • Selamat Memancing!"
    },

    // ══════════════════════════════════════
    //   STATUS & FITUR
    // ══════════════════════════════════════
    status: {
        public:   true,    // true = siapapun bisa pakai
        terminal: true,    // true = pairing code via terminal
        reactsw:  false    // true = auto react status WA
    },

    // Timeout sesi menu reply-angka (ms)
    sessionTTL: 60000,

    // ══════════════════════════════════════
    //   PESAN SISTEM
    // ══════════════════════════════════════
    message: {
        owner:   "⛔ Perintah ini hanya untuk owner bot.",
        group:   "⛔ Perintah ini hanya untuk group.",
        admin:   "⛔ Perintah ini hanya untuk admin group.",
        private: "⛔ Perintah ini hanya untuk chat private."
    },

    // ══════════════════════════════════════
    //   SOCIAL MEDIA (OPSIONAL)
    // ══════════════════════════════════════
    socialMedia: {
        YouTube:   "https://youtube.com/@-",
        GitHub:    "https://github.com/-",
        Telegram:  "https://t.me/-",
        ChannelWA: "https://whatsapp.com/channel/-"
    }
};

module.exports = config;

// Hot-reload saat file diubah
let _file = require.resolve(__filename);
require('fs').watchFile(_file, () => {
    require('fs').unwatchFile(_file);
    delete require.cache[_file];
    console.log('[CONFIG] settings/config.js diperbarui!');
});
  
