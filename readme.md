# 🐟 Fisch Bot v2.0 — WhatsApp Fishing Game Bot

Bot mancing berbasis WhatsApp yang dibangun di atas Baileys. Pemain bisa mancing ikan, upgrade rod, jelajahi pulau, koleksi mutasi, dan bersaing di leaderboard season.

---

## 📋 Daftar Perubahan (v1.1.0 → v2.0)

### 🔴 Critical Bug Fixes

| Bug | Deskripsi | Status |
|-----|-----------|--------|
| `ReferenceError: fishingRod is not defined` | Katalog rod (fishingRod object) sama sekali tidak ada padahal dipakai di 8+ tempat. `.shop`, `.buy`, `.view`, `.mancing` semua crash. | ✅ Fixed |
| `ReferenceError: travelRequirements is not defined` | Variabel `travelRequirements` dipanggil di `.travel` tapi tidak pernah didefinisikan. | ✅ Fixed |
| Bot tidak respon di grup | `m?.isGroup` bisa `undefined` di konteks tertentu. Group metadata fetch pakai `m.chat` yang bisa salah di grup. Sender detection pakai `m.key.participant` yang kadang kosong. | ✅ Fixed |
| Spam log "Fisch Bot — Aktif!" | Spinner pakai `process.stdout.write('\r' + ...)` yang tiap frame dianggap new line oleh PM2/logger → ribuan baris per menit. | ✅ Fixed |
| `protocolMessage` ter-log terus | Pesan sistem WA (read receipt, key sync, dll) tidak di-skip → memenuhi log. | ✅ Fixed |
| Hot-reload spawn multiple instances | `watchFile` selalu aktif bahkan di production → bisa spawn duplicate handler. | ✅ Fixed |
| Public mode block semua pesan grup | `config.status.public === false` block semua non-fromMe termasuk pesan grup. | ✅ Fixed |
| Prefix tidak detect di mention+command | Pesan "@bot .mancing" di grup tidak diproses karena prefix check gagal. | ✅ Fixed |

---

### ✨ Fitur Baru

#### 🌦️ Weather System
Cuaca berubah otomatis tiap **2 jam**, mempengaruhi hasil mancing:

| Cuaca | Efek |
|-------|------|
| ☀️ Cerah | Normal |
| ☁️ Mendung | +5% luck, rare/epic sedikit lebih sering |
| 🌧️ Hujan | +20% luck, rare/epic/legendary boost |
| ⛈️ Badai | +45% luck, legendary/mythic/godly boost — tapi waktu +40% |
| 🌫️ Berkabut | +5% mutation chance, ikan shadow muncul |
| 💨 Berangin | +30% speed, luck sedikit turun |
| ❄️ Blizzard | +35% luck, ikan kutub eksklusif |
| 🌙 Cahaya Bulan | +15% luck, secret/mythic boost, ikan lunar muncul |

Command: `.cuaca` / `.weather`

#### 🏆 Achievement System
**34 achievement** dibagi 7 kategori:
- 🎣 Memancing (first catch, 10/50/100/500/1000/5000 ikan)
- 💎 Rarity (rare, epic, legendary, mythic, godly, secret, extinct pertama)
- 🧬 Mutasi (mutasi pertama, 10 rare fish, 10 mutasi berbeda)
- 💰 Kekayaan (jutawan, miliarder, triliuner, 100M total jual)
- 🎣 Rod (level 5/20, enchant pertama, koleksi 3/7 rod)
- 🏝️ Eksplorasi (kunjungi 3 pulau, kunjungi semua pulau)
- ⭐ Spesial (ikan >1000kg, 10 perfect catch, mancing badai dapat mythic, 5x moonlight)

Tiap achievement kasih **reward otomatis** (money, tiket gacha, prestige token).

Command: `.ach` / `.achievement`, `.ach list`

#### 🎯 Reel Minigame (Perfect Catch)
Setelah `.mancing`, pemain bisa kirim `.reel` pada timing tepat untuk **Perfect Catch Bonus (×1.5 – ×2.5)**. Window timing random 3-15 detik, window aktif 4 detik.

Command: `.reel`

#### 🔥 Fishing Streak
Mancing berturut-turut tanpa dapat ikan common = streak naik!

| Streak | Bonus |
|--------|-------|
| 3x | +10% sell value |
| 5x | +20% sell value |
| 10x | +35% sell + luck bonus |
| 20x | +50% sell |
| 50x | +100% sell + mutation bonus |
| 100x | ×3 sell + rare fish boost |

Streak reset jika dapat ikan common. Command: `.streak`

#### 🐟 Fish Condition System
Tiap ikan punya kondisi random saat ditangkap:

| Kondisi | Chance | Efek Harga |
|---------|--------|-----------|
| ✨ Perfect | 5% | ×2.5 |
| 🌊 Segar | 15% | ×1.5 |
| 🔴 Raksasa | 4% | ×3.0 |
| 🦠 Sakit | 8% | ×0.4 |
| 📜 Tua | 6% | ×1.8 |
| ✨ Bersinar | 3% | ×4.0 |
| Normal | 59% | ×1.0 |

#### ⏰ Island Cooldown
Pulau mahal punya cooldown antar sesi mancing:

| Pulau | Cooldown |
|-------|---------|
| Mousewood | Tidak ada |
| Roslit Bay | Tidak ada |
| Mushgrove Swamp | Tidak ada |
| Terrapin Island | 30 detik |
| The Ocean | 45 detik |
| Atlantis | 90 detik |
| Volcani Depths | 2 menit |
| Crystal Caves | 3 menit |

#### ⚔️ World Boss System
Admin bisa spawn World Boss yang bisa diserang semua pemain secara kolektif:
- 🦑 Kraken Jr. (HP: 10.000)
- 🌊 Leviathan Purba (HP: 50.000)

Reward dibagi proporsional berdasarkan damage. Command: `.boss`, `.boss attack`

#### 🎨 Rod Skin System
Kosmetik untuk rod — tidak ngaruh ke stats:

| Skin | Cara Dapat | Harga |
|------|-----------|-------|
| Default | Gratis | - |
| Golden | Beli | 5M |
| Neon | Beli | 8M |
| Ocean | Beli | 12M |
| Sakura | Beli | 15M |
| Dragon | Beli | 50M |
| Cosmic | Gacha SSR | - |
| Void | Token Store | 100 tokens |
| Rainbow | Achievement 50 pts | - |

Command: `.skin`, `.skin buy <nama>`, `.skin equip <nama>`

#### 🐳 Biggest Fish Tracker
Bot catat ikan terberat yang pernah ditangkap pemain. Command: `.biggestfish`

#### 🛒 Enhanced .jual (Sell Filter)
Sekarang bisa filter ikan yang mau dijual:
- `.jual` → jual semua
- `.jual common` → jual hanya common
- `.jual rare+` → jual rare ke atas
- `.jual mutasi` → jual hanya yang bermutasi

---

### 🔧 Improvements

| Fitur | Sebelum | Sesudah |
|-------|---------|---------|
| `.mancing` info | Basic | Tampilkan cuaca, streak, island cooldown check |
| `.view` output | Teks biasa | Emoji rarity, kondisi ikan, streak bonus, cuaca efek, achievement notif, world boss dmg |
| `.jual` | Jual semua sekaligus | Filter by rarity, tampilkan summary per rarity |
| Connection handler | Spinner spam semua log | TTY-only spinner, stopSpinner on reconnect, exponential backoff |
| Group metadata | `m?.isGroup` (bisa undefined) | `isGroup` dari `from.endsWith('@g.us')` |
| Travel requirements | Crash (undefined) | Defined dengan syarat money + fish count per pulau |
| Player schema | Tidak ada tracking advanced | Tambah: achievements, biggestFish, rareFishCaught, perfectCatches, totalEarned, ownedSkins, islandCooldowns |
| Hot-reload | Selalu aktif | Hanya aktif jika `NODE_ENV=development` |

---

## 🎮 Command List Lengkap

### 🎣 Mancing
| Command | Alias | Deskripsi |
|---------|-------|-----------|
| `.mancing` | `.fish` | Mulai mancing |
| `.view` | - | Ambil hasil pancingan |
| `.reel` | - | Perfect catch timing minigame |
| `.jual [filter]` | `.sell` | Jual ikan di inventory |
| `.inventory` | `.inv` | Lihat inventory & rod stats |

### 🏝️ Eksplorasi
| Command | Deskripsi |
|---------|-----------|
| `.travel` | Lihat menu pulau |
| `.travel <pulau>` | Pindah ke pulau |
| `.cuaca` / `.weather` | Info cuaca saat ini |

### 📊 Statistik
| Command | Alias | Deskripsi |
|---------|-------|-----------|
| `.profile` | - | Profil pemain |
| `.streak` | - | Fishing streak & bonus |
| `.achievement` | `.ach` | Achievement progress |
| `.biggestfish` | `.bigfish` | Ikan terberat pernah ditangkap |
| `.season` | `.s` | Leaderboard season |

### 🎣 Rod & Upgrade
| Command | Deskripsi |
|---------|-----------|
| `.shop` | Toko rod & item |
| `.buy <rod>` | Beli rod |
| `.equip <rod>` | Pakai rod |
| `.upgrade` | Upgrade stats |
| `.enchant` | Lihat enchant scrolls |
| `.skin` | Rod skin shop |

### 🎰 Gacha & Economy
| Command | Deskripsi |
|---------|-----------|
| `.gacha` | Pull gacha (tiket/coins) |
| `.jackpot <amount>` | Gambling |
| `.transfer <user> <amount>` | Transfer uang |
| `.prestige` | Lihat info prestige |
| `.tokenstore` | Tukar prestige tokens |

### ⚔️ World Boss
| Command | Deskripsi |
|---------|-----------|
| `.boss` | Info boss aktif |
| `.boss attack` | Serang world boss |

### 📋 Lainnya
| Command | Deskripsi |
|---------|-----------|
| `.menu` | Tampilkan menu utama |
| `.ping` | Cek latency bot |
| `.event` | Info event aktif |
| `.leaderboard` | Top pemain |

---

## 🚀 Setup & Deployment

### Requirements
- Node.js ≥ 18
- MongoDB (Atlas atau self-hosted)
- WhatsApp number aktif

### Install
```bash
npm install
```

### Config
Edit `settings/config.js`:
```js
mongoSrv: 'mongodb+srv://...',    // wajib
botOwner: ['62xxx'],              // nomor owner
prefix: '.',
```

### Run
```bash
# Development (hot-reload aktif)
NODE_ENV=development node index.js

# Production
node index.js

# PM2 (recommended)
pm2 start index.js --name fischbot
pm2 logs fischbot
```

---

## 📁 Struktur File

```
fischv1100_FIXED/
├── index.js              # Entry point, WA connection
├── message.js            # Main game handler (~5200 baris)
├── settings/
│   └── config.js         # Konfigurasi
├── command/              # Plugin commands external
├── sessions/             # WA session (auto-generated)
└── w-shennmine/
    └── lib/
        ├── connect.js    # Connection handler (spinner, reconnect)
        └── myfunction.js # smsg, sleep, dll
```

---

## 🐛 Known Issues / TODO
- [ ] Persistent streak (saat ini in-memory, reset jika restart)
- [ ] World boss reward distribution belum diimplementasi penuh (in-memory)
- [ ] Night catcher achievement counter belum persistent
- [ ] Cuaca eksklusif ikan (Rainfish dll) belum ditambahkan ke island fish list

---

*Fisch Bot v2.0 — dibuat dengan ❤️ untuk komunitas developer Indonesia*
