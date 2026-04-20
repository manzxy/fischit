# 🐟 Fisch Bot — WhatsApp Fishing Game Bot

> Bot WhatsApp game memancing berbasis **Fisch (Roblox)** — dengan sistem fishing, island, rod, mutasi, season, gacha, prestige, dan banyak lagi!

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=flat-square&logo=node.js)
![Baileys](https://img.shields.io/badge/Baileys-6.7%2B-blue?style=flat-square)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?style=flat-square&logo=mongodb)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

</div>

---

## 📋 Daftar Isi

- [Fitur](#-fitur)
- [Syarat](#-syarat)
- [Instalasi](#-instalasi)
- [Konfigurasi](#-konfigurasi)
- [Menjalankan Bot](#-menjalankan-bot)
- [Cara Main](#-cara-main)
- [Daftar Command](#-daftar-command)
- [Struktur Folder](#-struktur-folder)
- [FAQ](#-faq)

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🎣 Fishing System | Mancing dengan timer, kombo ikan, hasil random berdasarkan rarity |
| 🏝️ 8 Island | Mousewood → Atlantis → Crystal Caves, tiap pulau punya ikan eksklusif |
| 🎣 30+ Fishing Rod | Dari Basic Rod sampai Omega Rod & Eternity Rod |
| ✨ Enchant System | 50+ jenis enchant dengan rarity common–secret |
| 🧬 Mutation System | 100+ mutasi langka yang bisa ditemukan saat memancing |
| 🏆 Season System | Kompetisi antar pemain, reset berkala, hadiah rod eksklusif |
| 🎰 Gacha System | Pull rod & reward dengan tiket atau coins |
| 👑 Prestige System | Naik prestige untuk bonus permanen dan rod eksklusif |
| 📱 Telegram Bridge | Notifikasi & main via Telegram |
| 🛒 Token Shop | Belanja rod & tiket dengan prestige token |
| 📊 Leaderboard | Ranking uang, ikan, dan level |
| 🎁 Daily Reward | Streak harian dengan hadiah makin besar |

---

## 🔧 Syarat

Sebelum mulai, pastikan kamu punya:

- **Node.js versi 18 atau lebih** — [Download di sini](https://nodejs.org)
- **MongoDB Atlas** (gratis) — [Daftar di sini](https://mongodb.com/atlas)
- **Nomor WhatsApp** yang tidak aktif dipakai di HP (khusus untuk bot)
- **VPS / server** atau bisa juga di laptop (Linux/Windows/Mac)

---

## 🚀 Instalasi

### Langkah 1 — Clone / Download

```bash
# Kalau pakai git
git clone https://github.com/USERNAME/fischv1100.git
cd fischv1100

# Atau extract ZIP yang sudah didownload
unzip fischv1100_FIXED.zip
cd fischv1100_FIXED
```

### Langkah 2 — Install dependensi

```bash
npm install
```

> ⏳ Proses ini butuh beberapa menit. Tunggu sampai selesai.

### Langkah 3 — Siapkan MongoDB

1. Buka [mongodb.com/atlas](https://mongodb.com/atlas) → **Sign Up** (gratis)
2. Buat **cluster baru** (pilih Free / M0)
3. Buat **database user**: Database Access → Add New User → catat username & password
4. Whitelist IP: Network Access → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`)
5. Ambil **connection string**: Clusters → Connect → Drivers → Node.js
   - Formatnya: `mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/?appName=FischBot`

### Langkah 4 — Konfigurasi

Edit file `settings/config.js`:

```js
owner:    "6281234567890",   // Nomor WA kamu (format 62xxx, tanpa + atau spasi)
admins:   ["6281234567890"], // Sama dengan owner (bisa tambah nomor lain)
mongoSrv: "mongodb+srv://user:pass@cluster.mongodb.net/?appName=FischBot",
```

> ⚠️ **Penting:** Format nomor harus `62xxx` bukan `08xxx` atau `+62xxx`

---

## ⚙️ Konfigurasi

Buka `settings/config.js` — semua pengaturan ada di sini:

```js
const config = {
    // ── WAJIB DIISI ────────────────────────────────
    owner:    "6281234567890",          // Nomor owner bot
    admins:   ["6281234567890"],        // Nomor admin (boleh lebih dari 1)
    mongoSrv: "mongodb+srv://...",      // MongoDB connection string
    session:  "sessions",              // Nama folder session (jangan diubah)

    // ── TELEGRAM (OPSIONAL) ────────────────────────
    telegram: {
        enabled:  false,               // Ganti true kalau mau pakai Telegram
        botToken: "TOKEN_DARI_BOTFATHER",
    },

    // ── STATUS BOT ─────────────────────────────────
    status: {
        public:   true,   // true = semua orang bisa pakai, false = khusus teman
        terminal: true,   // true = pairing code di terminal (disarankan)
        reactsw:  false,  // true = auto react status WA
    },
};
```

---

## ▶️ Menjalankan Bot

### Cara 1 — Pairing Code (Disarankan)

Pastikan `status.terminal: true` di config, lalu:

```bash
npm start
```

Terminal akan menampilkan kode seperti ini:
```
╔══════════════════════════════╗
║  🔑 PAIRING CODE: ABCD-1234  ║
╚══════════════════════════════╝
👉 Buka WA → Linked Devices → Link with phone number
```

Buka WhatsApp di HP → **Setelan** → **Perangkat Tertaut** → **Tautkan Perangkat** → masukkan kode.

### Cara 2 — QR Code

Ubah `status.terminal: false` di config, lalu:

```bash
npm start
```

Scan QR yang muncul di terminal menggunakan WhatsApp.

### Cara 3 — Pakai PM2 (VPS, agar berjalan terus)

```bash
# Install PM2
npm install -g pm2

# Jalankan bot
pm2 start index.js --name fisch-bot

# Lihat log
pm2 logs fisch-bot

# Restart
pm2 restart fisch-bot

# Otomatis jalan saat server reboot
pm2 startup
pm2 save
```

---

## 🎮 Cara Main

### Mulai pertama kali

1. Kirim pesan ke nomor bot: `.menu`
2. Bot akan membalas dengan daftar command
3. Mulai mancing dengan: `.mancing`
4. Ambil hasil: `.view`
5. Jual ikan: `.jual`

### Alur main dasar

```
.mancing         ← mulai memancing (tunggu beberapa detik)
.view            ← ambil ikan hasil pancingan
.inventory       ← lihat ikan di tas
.jual            ← jual semua ikan, dapat uang
.money           ← cek saldo
.shop            ← lihat toko rod
.buy luckyrod    ← beli rod baru
.equip luckyrod  ← pasang rod
.mancing         ← ulangi!
```

### Tips untuk pemula

- 🎯 Upgrade rod dulu sebelum pindah pulau
- 💰 Gunakan `.daily` setiap hari untuk streak bonus
- 🏝️ Pindah pulau dengan `.travel` untuk ikan lebih mahal
- ✨ Enchant rod dengan `.enchant` untuk bonus stats
- 🏆 Cek posisi kamu di `.top`

---

## 📖 Daftar Command

### 🎣 Fishing
| Command | Keterangan |
|---|---|
| `.mancing` | Mulai memancing |
| `.view` | Ambil hasil pancingan |
| `.inventory` | Lihat isi tas |
| `.jual` | Jual semua ikan |
| `.fishbook` | Koleksi ikan yang pernah ditemukan |
| `.mutationbook` | Koleksi mutasi yang pernah ditemukan |

### 🏝️ Pulau & Rod
| Command | Keterangan |
|---|---|
| `.travel` | Lihat daftar pulau |
| `.travel <pulau>` | Pindah ke pulau (contoh: `.travel roslitbay`) |
| `.shop` | Toko fishing rod |
| `.buy <rod>` | Beli rod (contoh: `.buy luckyrod`) |
| `.equip <rod>` | Pasang rod aktif |
| `.listrod` | Lihat rod yang dimiliki |
| `.enchant` | Info enchant rod aktif |
| `.enchant confirm` | Lakukan enchant (biaya coin) |
| `.listenchant` | Daftar semua enchant |
| `.rodupgrade` | Upgrade rod permanen |
| `.rodupgrade confirm` | Konfirmasi upgrade rod |

### 💰 Ekonomi
| Command | Keterangan |
|---|---|
| `.money` | Cek saldo |
| `.transfer <user> <jml>` | Kirim uang ke teman (contoh: `.transfer hann 1B`) |
| `.gift <user> <id>` | Kirim ikan ke teman |
| `.jackpot <jml>` | Gambling (menang 40%, dapat 2.5x) |
| `.donate <jml>` | Donasi untuk season points |

### 👤 Profil & Sosial
| Command | Keterangan |
|---|---|
| `.me` | Profil kamu |
| `.player <nama/id>` | Profil pemain lain |
| `.rename <nama>` | Ganti username |
| `.top` | Leaderboard |
| `.addfriend <nama>` | Kirim request teman |
| `.f-accept <nama>` | Terima request teman |
| `.f-decline <nama>` | Tolak request teman |
| `.delfriend <nama>` | Hapus teman |
| `.listfriend` | Daftar teman |
| `.requestfriends` | Lihat request masuk |
| `.resetme` | Reset akun (hati-hati!) |

### 👑 Sistem & Progress
| Command | Keterangan |
|---|---|
| `.stats` | Lihat semua stats |
| `.upgrade` | Info upgrade permanen |
| `.upgrade luck` | Upgrade luck stat |
| `.upgrade speed` | Upgrade speed stat |
| `.upgrade sell` | Upgrade sell value |
| `.daily` | Ambil hadiah harian |
| `.gacha` | Info gacha |
| `.gacha pull` | 1x pull pakai tiket |
| `.gacha coins` | 1x pull pakai coins |
| `.gacha multi` | 10x pull (hemat) |
| `.prestige` | Info & syarat prestige |
| `.prestige confirm` | Konfirmasi naik prestige |
| `.tokenstore` | Toko prestige token |
| `.tokenstore beli <no>` | Beli item dengan token |

### 🏆 Season
| Command | Keterangan |
|---|---|
| `.season` | Info season aktif & leaderboard |
| `.seasonhistory` | Riwayat season lalu |

### 📱 Telegram
| Command | Keterangan |
|---|---|
| `.linktele` | Hubungkan ke Telegram |
| `.unlinktele` | Putus koneksi Telegram |
| `.teleinfo` | Status koneksi Telegram |

### ℹ️ Info
| Command | Keterangan |
|---|---|
| `.menu` | Daftar semua command |
| `.ping` | Cek respons bot |
| `.version` | Versi bot |

### 🔧 Admin Only
| Command | Keterangan |
|---|---|
| `.setmoney <user> <jml>` | Set uang pemain |
| `.addmoney <user> <jml>` | Tambah uang pemain |
| `.setlevel <user> <lv>` | Set level pemain |
| `.setfishcaught <user> <jml>` | Set jumlah ikan |
| `.forceenchant <user> <rod> <enchant>` | Force enchant rod |
| `.resetall` | Hapus semua data pemain |
| `.database` | Backup database ke file JSON |
| `.refreshall` | Refresh data semua pemain |
| `.importdata` | Import dari fishing.json |
| `.resetseason` | Reset season manual |
| `.setseason <hari>` | Set durasi season |
| `.event start <nama> <jam> <mult>` | Mulai event |
| `.event stop` | Hentikan event |

---

## 📁 Struktur Folder

```
fischv1100/
├── index.js              ← Entry point, koneksi WA
├── message.js            ← Handler semua command & game logic
├── package.json          ← Dependensi npm
│
├── settings/
│   └── config.js         ← ⚙️ KONFIGURASI UTAMA (edit di sini)
│
├── command/              ← Plugin command eksternal (opsional)
│
├── sessions/             ← Session WhatsApp (auto-generated, jangan dihapus)
│
└── w-shennmine/
    └── lib/
        ├── connection/
        │   └── connect.js    ← Handler koneksi & reconnect
        ├── myfunction.js     ← Helper functions
        ├── telegram.js       ← Telegram bot bridge
        ├── exif.js           ← Sticker/exif helper
        ├── fquoted.js        ← Quote message helper
        ├── color.js          ← Terminal color helper
        └── media/
            └── w-shennmine.jpg ← Thumbnail gambar
```

---

## ❓ FAQ

**Q: Bot tidak merespon command**
> Pastikan prefix di config sesuai. Default prefix adalah `.` — ketik `.ping` untuk tes.

**Q: Error `mongoSrv belum diisi`**
> Isi `mongoSrv` di `settings/config.js` dengan connection string MongoDB Atlas yang valid.

**Q: Pairing code tidak muncul / error**
> Hapus folder `sessions/` lalu restart: `rm -rf sessions/ && npm start`

**Q: Session sering putus / logout sendiri**
> Jangan buka WhatsApp Web di browser bersamaan. Satu nomor hanya bisa dipakai di satu perangkat.

**Q: Error `not-acceptable` saat kirim pesan**
> Update ke versi terbaru. Error ini sudah difix di versi ini.

**Q: Command admin tidak jalan**
> Pastikan format nomor di `admins` sama persis dengan format `senderNumber` — gunakan `62xxx` (bukan `08xxx`).

**Q: Bot berjalan di Windows?**
> Ya, tapi VPS Linux lebih stabil. Kalau Windows, pakai WSL atau Node.js for Windows.

**Q: Bisa dijalankan di HP Android?**
> Bisa pakai [Termux](https://termux.dev) di Android, lalu install Node.js di dalamnya.

---

## 🛠️ Troubleshooting

### Bot tidak connect sama sekali
```bash
# Hapus session dan coba lagi
rm -rf sessions/
npm start
```

### Error saat `npm install`
```bash
# Coba dengan legacy peer deps
npm install --legacy-peer-deps
```

### Bot connect tapi tidak respon
```bash
# Cek log
pm2 logs fisch-bot

# Pastikan MongoDB terhubung (lihat log "✅ Database Fisch connected")
```

### Session terus corrupt
> Pastikan tidak ada 2 instance bot berjalan bersamaan:
```bash
pm2 list           # lihat semua proses
pm2 delete all     # hapus semua
pm2 start index.js --name fisch-bot
```

---

## 📜 License

MIT License — bebas digunakan dan dimodifikasi.

---

<div align="center">

Made with ❤️ by **Manzxy** • [GitHub](https://github.com/manzxy)

🎣 *Selamat Memancing!*

</div>
