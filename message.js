'use strict';
// ── FISCH BOT — message.js ────────────────────────────
// Struktur bersih: semua konstanta & fungsi di top-level,
// handler hanya berisi logic per-pesan.
// ─────────────────────────────────────────────────────

let q = '';
/**
 * ══════════════════════════════════════════
 *   FISCH BOT — message.js
 *   Handler utama pesan WhatsApp + game data
 * ══════════════════════════════════════════
 */

const config  = require('./settings/config');
const fs      = require('fs');
const axios   = require('axios');
const chalk   = require('chalk');
const util    = require('util');
const crypto  = require('crypto');
const fetch   = require('node-fetch');
const moment  = require('moment-timezone');
const path    = require('path');
const os      = require('os');
const { exec } = require('child_process');
const { default: baileys, getContentType } = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const { initTelegram, notifyTelegram } = require('./w-shennmine/lib/telegram');
const { smsg, fetchJson, sleep, formatSize, runtime, getBuffer } = require('./w-shennmine/lib/myfunction');
const { fquoted } = require('./w-shennmine/lib/fquoted');

// Media thumbnail (dimuat sekali saat startup)
let _thumbBuffer = null;
function getThumb() {
    if (!_thumbBuffer) {
        const p = require('path').join(__dirname, './w-shennmine/lib/media/w-shennmine.jpg');
        _thumbBuffer = require('fs').existsSync(p) ? require('fs').readFileSync(p) : null;
    }
    return _thumbBuffer;
}

// ── Dari config (tidak hardcode lagi) ──────────────
const botAdmins = config.admins || [];
const MONGO_SRV = config.mongoSrv;

if (!MONGO_SRV || MONGO_SRV.includes('USER:PASS') || MONGO_SRV.includes('-:-')) {
    console.error('\n❌ mongoSrv belum diisi di settings/config.js!\n');
    process.exit(1);
}

// ===== MONGODB CONNECTION =====
let isMongoConnected = false;
mongoose.connect(MONGO_SRV, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
})
.then(() => {
    isMongoConnected = true;
    console.log("✅ Database Fisch connected");
})
.catch(err => {
    console.error("❌ Database Fisch connection error:", err.message || err);
    console.error("   Periksa config.mongoSrv di settings/config.js");
});

mongoose.connection.on('disconnected', () => {
    isMongoConnected = false;
    console.log('⚠️ MongoDB disconnected. Reconnecting...');
    setTimeout(() => mongoose.connect(config.mongoSrv).catch(console.error), 5000);
});

// ===== SCHEMA & MODEL (didefinisikan sekali di luar handler) =====
const rodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: "rod" },
  luck: { type: Number, default: 0 },
  speed: { type: Number, default: 0 },
  comboFish: { type: Number, default: 1 },
  comboMutations: { type: Number, default: 1 },
  mutationsLuck: { type: Number, default: 0 },
  sellMultiplier: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  enchant: { type: String, default: null },
  bonusStats: { type: Object, default: {} },
  description: { type: String, default: "" },
  level: { type: Number, default: 1 },
  maxLevel: { type: Number, default: 5 },
  exp: { type: Number, default: 0 },
  expToNextLevel: { type: Number, default: 100 },
  enchantCount: { type: Number, default: 0 }
}, { _id: false });

const playerSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    username: String,
    money: { type: Number, default: 200 },
    inventory: { type: Array, default: [] },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    expToNextLevel: { type: Number, default: 100 },
    maxLevel: { type: Number, default: 9999 },
    usedFishingRod: { type: String, default: "basicrod" },
    fishingRods: { type: Map, of: rodSchema, default: {} },
    currentIsland: { type: String, default: "mousewood" },
    fishingPending: { type: Array, default: [] },
    fishFound: { type: Array, default: [] },
    mutationFound: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now },
    friends: { type: Array, default: [] },
    pendingFriends: { type: Array, default: [] },
    travelFound: { type: Array, default: [] },
    fishCaught: { type: Number, default: 0 },
    isVerifiedTelegram: { type: Boolean, default: false },
    whatsappNumber: { type: String, default: null },
    telegramId: { type: String, default: null },
    telegramUUID: { type: String, default: null },
    telegramConnectID: { type: String, default: null },
    telegramUsername:  { type: String, default: null },
    // Gacha & prestige
    gachaTickets:     { type: Number, default: 0 },
    gachaPity:        { type: Number, default: 0 },
    prestigeTokens:   { type: Number, default: 0 },
    prestige:         { type: Number, default: 0 },
    title:            { type: String, default: null },
    seasonPoints:     { type: Number, default: 0 },
    seasonWins:       { type: Number, default: 0 },
    // Upgrades permanen
    luckUpgrade:      { type: Number, default: 0 },
    speedUpgrade:     { type: Number, default: 0 },
    sellUpgrade:      { type: Number, default: 0 },
    // Daily reward
    lastDaily:        { type: Date, default: null },
    dailyStreak:      { type: Number, default: 0 },
    // Active buffs dari gacha
    activeBoosts:     { type: Object, default: {} },
});

const Player = mongoose.models.Player || mongoose.model("Player", playerSchema);

const telegramSessionSchema = new mongoose.Schema({
    tempTelegramId: { type: String, required: true },
    tempWhatsAppNumber: { type: String, required: true },
    verificationCode: { type: String, required: true, index: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 5 * 60 * 1000) }, // 5 menit
    createdAt: { type: Date, default: Date.now }
});
// Auto-delete expired sessions
telegramSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const TelegramSession = mongoose.models.TelegramSession || mongoose.model("TelegramSession", telegramSessionSchema);

// ── Season History Schema ──────────────────────────
const seasonHistorySchema = new mongoose.Schema({
    seasonNumber: { type: Number, required: true },
    name:         { type: String, default: "" },
    startDate:    { type: Date, required: true },
    endDate:      { type: Date, required: true },
    winner1: { username: String, id: Number, points: Number },
    winner2: { username: String, id: Number, points: Number },
    winner3: { username: String, id: Number, points: Number },
    totalPlayers: { type: Number, default: 0 },
    createdAt:    { type: Date, default: Date.now },
});
const SeasonHistory = mongoose.models.SeasonHistory || mongoose.model("SeasonHistory", seasonHistorySchema);

// ── Global Season State (di-load dari DB atau default) ─
let currentSeason = {
    number: 1,
    name: "Season 1 — Age of Tides",
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 hari default
    active: true,
};

// Load season state on startup — retry sampai MongoDB ready
async function loadSeasonFromDB(attempt = 1) {
    const MAX_ATTEMPT = 10;
    try {
        if (!isMongoConnected) throw new Error('MongoDB belum connect');
        const last = await SeasonHistory.findOne().sort({ seasonNumber: -1 });
        if (last) {
            currentSeason.number = last.seasonNumber + 1;
            currentSeason.name = `Season ${currentSeason.number}`;
            currentSeason.startDate = last.endDate || new Date();
        }
        console.log(`[SEASON] ✅ Season ${currentSeason.number} aktif | Berakhir: ${currentSeason.endDate.toLocaleDateString('id-ID')}`);
    } catch(e) {
        if (attempt < MAX_ATTEMPT) {
            console.log(`[SEASON] ⏳ Menunggu DB... retry ${attempt}/${MAX_ATTEMPT}`);
            setTimeout(() => loadSeasonFromDB(attempt + 1), 5000);
        } else {
            console.error(`[SEASON] ❌ Gagal load season setelah ${MAX_ATTEMPT}x: ${e.message}`);
            console.log(`[SEASON] ⚠️  Menggunakan Season default (Season 1)`);
        }
    }
}
setTimeout(() => loadSeasonFromDB(), 5000);

// ── Auto season reset cron (cek tiap jam) ─────────────
setInterval(async () => {
    try {
        if (!currentSeason.active) return;
        if (Date.now() < currentSeason.endDate.getTime()) return;
        console.log('[SEASON] ⏰ Season berakhir! Memproses reset...');
        await doSeasonReset(null);
    } catch(e) { console.error('[SEASON] auto-reset error:', e.message); }
}, 60 * 60 * 1000); // cek tiap 1 jam

async function doSeasonReset(adminReply) {
    try {
        // Ambil top 3
        const top3 = await Player.find({ seasonPoints: { $gt: 0 } })
            .sort({ seasonPoints: -1 }).limit(3);

        // Simpan ke history
        await SeasonHistory.create({
            seasonNumber: currentSeason.number,
            name: currentSeason.name,
            startDate: currentSeason.startDate,
            endDate: new Date(),
            winner1: top3[0] ? { username: top3[0].username, id: top3[0].id, points: top3[0].seasonPoints } : null,
            winner2: top3[1] ? { username: top3[1].username, id: top3[1].id, points: top3[1].seasonPoints } : null,
            winner3: top3[2] ? { username: top3[2].username, id: top3[2].id, points: top3[2].seasonPoints } : null,
            totalPlayers: await Player.countDocuments({ seasonPoints: { $gt: 0 } }),
        });

        // Beri hadiah ke top 3
        const prizes = [
            { rod: "omegaRod", tokens: 500, money: 10000000000000, title: "🥇 Season Champion" },
            { rod: "cosmicrod", tokens: 200, money: 1000000000000,  title: "🥈 Season Runner-up" },
            { rod: "voidrod",   tokens: 100, money: 100000000000,   title: "🥉 Season Bronze" },
        ];

        let announceText = `🏆 *SEASON ${currentSeason.number} BERAKHIR!*\n\n`;
        announceText += `📅 Durasi: ${currentSeason.startDate.toLocaleDateString('id-ID')} — ${new Date().toLocaleDateString('id-ID')}\n\n`;
        announceText += `🎖️ *PEMENANG:*\n`;

        for (let i = 0; i < Math.min(top3.length, 3); i++) {
            const winner = top3[i];
            const prize  = prizes[i];
            announceText += `${prize.title} *${winner.username}* — ${winner.seasonPoints} pts\n`;

            winner.title = prize.title.replace(/[🥇🥈🥉] /, '');
            winner.money = (winner.money || 0) + prize.money;
            winner.prestigeTokens = (winner.prestigeTokens || 0) + prize.tokens;
            winner.seasonWins = (winner.seasonWins || 0) + 1;
            if (!winner.fishingRods.get(prize.rod)) {
                winner.fishingRods.set(prize.rod, { ...fishingRod[prize.rod] });
                winner.markModified('fishingRods');
            }
            await winner.save();
        }

        announceText += `\n🎁 Hadiah telah dikirim ke pemenang!\n`;
        announceText += `🔄 Season baru dimulai sekarang!`;

        // Reset semua season points
        await Player.updateMany({}, { $set: { seasonPoints: 0 } });

        // Set season baru
        currentSeason = {
            number: currentSeason.number + 1,
            name: `Season ${currentSeason.number + 1}`,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            active: true,
        };

        console.log(`[SEASON] ✅ Season ${currentSeason.number} dimulai!`);
        if (adminReply) adminReply(announceText);
        return announceText;
    } catch(e) {
        console.error('[doSeasonReset]', e.message);
        if (adminReply) adminReply('❌ Error saat reset season: ' + e.message);
    }
}

// ===== END OF TOP-LEVEL INIT =====

// Init Telegram bot — dipanggil sekali di level module
// Delay 3s agar mongoose sempat connect dulu
setTimeout(() => {
    try {
        initTelegram(config, Player, TelegramSession);
    } catch (e) {
        console.error('[TELEGRAM] Init error:', e.message);
    }
}, 3000);


// ===== HELPERS & CONSTANTS (top-level) =====



// ===== HELPER FUNCTIONS =====

async function getOrCreateUser(senderNumber, telegramId = null) {
  let query = senderNumber
    ? { whatsappNumber: senderNumber }
    : { telegramId };

  let user = await Player.findOne(query);

  if (!user) {
    user = new Player({
      id: await generatePlayerId(),
      username: await generateUniqueUsername(),
      money: 200,
      inventory: [],
      level: 1,
      exp: 0,
      expToNextLevel: 100,
      maxLevel: 9999,
      usedFishingRod: "basicrod",
      fishingRods: {
        basicrod: {
          name: "Basic Fishing Rod",
          type: "rod",
          luck: 0.00,
          speed: 0.00,
          comboFish: 1,
          comboMutations: 1,
          mutationsLuck: 0.000,
          price: 0,
          enchant: null,
          bonusStats: {},
          description: "",
          level: 1,
          maxLevel: 5,
          exp: 0,
          expToNextLevel: 100
        }
      },
      currentIsland: "mousewood",
      fishingPending: [],
      fishFound: [],
      mutationFound: [],
      createdAt: Date.now(),
      friends: [],
      pendingFriends: [],
      travelFound: [],
      fishCaught: 0,
      isVerifiedTelegram: !!telegramId,
      whatsappNumber: senderNumber || null,
      telegramId: telegramId || null,
      telegramUUID: null,
      telegramConnectID: null
    });

    await user.save();
  }

  return user;
}

async function importFishingJSON() {
    const dbPath = path.join(__dirname, "fishing.json");

    if (!fs.existsSync(dbPath)) {
        return;
    }

    const rawData = fs.readFileSync(dbPath, "utf-8");
    let data;
    try {
        data = JSON.parse(rawData);
    } catch (err) {
        return;
    }

    let addedCount = 0;
    let skippedCount = 0;

    for (const [number, playerData] of Object.entries(data)) {
        const exists = await Player.findOne({ id: playerData.id });
        if (exists) {
            skippedCount++;
            continue;
        }

        const newPlayer = new Player(playerData);
        await newPlayer.save();
        addedCount++;
    }

    return `✅ Import selesai: ${addedCount} player ditambahkan, ${skippedCount} player sudah ada dan dilewati.`
}

async function generateUniqueUsername() {
    let counter = 1;
    let username;
    let exists = true;

    while (exists) {
        username = "Player" + counter;
        exists = await Player.exists({ username });
        counter++;
    }

    return username;
}

async function generatePlayerId() {
    const lastUser = await Player.findOne().sort({ id: -1 }).exec();

    const lastId = lastUser?.id ? parseInt(lastUser.id, 10) : 10000001 - 1;

    return lastId + 1;
}

async function addRodExp(user, rodKey, amount) {
    const rod = user.fishingRods.get(rodKey);
    if (!rod || rod.level >= rod.maxLevel) return null;

    rod.exp += amount;
    let levelUp = false;
    let statsIncreased = [];

    while (rod.exp >= rod.expToNextLevel && rod.level < rod.maxLevel) {
        rod.exp -= rod.expToNextLevel;
        rod.level++;
        levelUp = true;
        rod.expToNextLevel = 100 * rod.level;

        rod.speed += 0.01;
        statsIncreased.push(`Speed +0.01`);

        if (rod.level % 3 === 0) {
            rod.sellMultiplier = (rod.sellMultiplier || 1) + 0.1;
            statsIncreased.push(`Sell Multiplier +0.1`);
        }

        if (rod.level % 5 === 0) {
            rod.luck += 0.01;
            statsIncreased.push(`Luck +0.01`);
        }

        if (rod.level % 10 === 0) {
            rod.mutationsLuck += 0.0001;
            statsIncreased.push(`Mutations Luck +0.0001`);
        }
    }

    if (levelUp) {
        user.markModified(`fishingRods`);
        await user.save();
        return `🎣 Rod *${rod.name}* naik ke level ${rod.level}!\n✨ Stats meningkat: ${statsIncreased.join(", ")}`;
    }

    return null;
}

function addPlayerExp(user, amount) {
  if (user.level >= user.maxLevel) {
    return `🏆 Kamu sudah mencapai level maksimal (${user.maxLevel})!`;
  }

  user.exp += amount;
  let levelUpMsg = "";

  while (user.exp >= user.expToNextLevel && user.level < user.maxLevel) {
    user.exp -= user.expToNextLevel;
    user.level++;
    user.expToNextLevel = Math.floor(user.expToNextLevel * 1.2);
    levelUpMsg += `🧍 Kamu naik ke level ${user.level}!\n`;
  }

  return levelUpMsg;
}

function mutationChance(mutationsObj, maxCount = 1, bonus = 0) {
    const keys = Object.keys(mutationsObj);

    const found = [];
    for (const key of keys) {
        if (found.length >= maxCount) break;
        const m = mutationsObj[key];

        const baseChance = m?.chance || 0;
        const finalChance = Math.max(0, Math.pow(baseChance, 3) + (bonus || 0));

        if (Math.random() < finalChance) {
            found.push(key);
        }
    }

    if (found.length === 0) return ["Normal"];
    return found;
}

function getRandomFish(rod, island = "mousewood", perfectCatch = false) {
    const islandData = islands[island];
    if (!islandData) throw new Error(`Pulau "${island}" tidak ditemukan!`);

    const fishList = islandData.listFish;

        const enchant = rod?.enchant ? rodEnchants[rod.enchant] : null;

    let luckBonus = rod?.luck || 0;
    if (enchant?.effect?.luck) luckBonus += (enchant.effect.luck - 1);

    const rarityChance = {
        common: 50, uncommon: 30, rare: 12, epic: 5,
        legendary: 2, mythic: 0.8, godly: 0.4, exotic: 0.3,
        secret: 0.1, relic: 0.05, fragment: 0.03, gemstone: 0.02,
        extinct: 0.01, limited: 0.008, apex: 0.005,
        cataclysmic: 0.003, special: 0.001
    };

    const rarityBoostMap = {
        common: 1 - (luckBonus * 0.5),
        uncommon: 1 - (luckBonus * 0.3),
        rare: 1 + (luckBonus * 0.2),
        epic: 1 + (luckBonus * 0.5),
        legendary: 1 + (luckBonus * 0.8),
        mythic: 1 + (luckBonus * 1.2),
        godly: 1 + (luckBonus * 2.0),
        exotic: 1 + (luckBonus * 2.5),
        secret: 1 + (luckBonus * 3.5),
        relic: 1 + (luckBonus * 4.0),
        fragment: 1 + (luckBonus * 4.5),
        gemstone: 1 + (luckBonus * 5.0),
        extinct: 1 + (luckBonus * 6.0),
        limited: 1 + (luckBonus * 6.5),
        apex: 1 + (luckBonus * 7.0),
        cataclysmic: 1 + (luckBonus * 8.0),
        special: 1 + (luckBonus * 10.0)
    };

    const adjustedFishList = fishList.map(f => {
        const baseChance  = rarityChance[f.rarity] || 1;
        const rarityBoost = rarityBoostMap[f.rarity] || 1;
        return {
            ...f,
            adjChance: Math.max(baseChance * rarityBoost, 0.1)
        };
    });

const totalChance = adjustedFishList.reduce((a, b) => a + b.adjChance, 0);

const roll = Math.random() * totalChance;
let acc = 0;
let chosen = adjustedFishList[0];

for (let fish of adjustedFishList) {
    acc += fish.adjChance;
    if (roll <= acc) {
        chosen = fish;
        break;
    }
}

    let weight = chosen.minKg + Math.random() * (chosen.maxKg - chosen.minKg);

    if (Math.random() < 0.03) {
        const hugeMultiplier = 1.8 + Math.random() * 4.7;
        weight *= hugeMultiplier;
        chosen.name = "🌟 " + chosen.name;
    }

    if (enchant?.effect?.fishSize) weight *= enchant.effect.fishSize;
    weight = parseFloat(weight.toFixed(2));

    let totalPrice = Math.round(chosen.avgValue * weight);

    let baseMutationLuck = rod?.mutationsLuck || 0;
    if (enchant?.effect?.mutationChance) baseMutationLuck += enchant.effect.mutationChance;
    if (enchant?.effect?.mutationChanceBonus) baseMutationLuck += enchant.effect.mutationChanceBonus;

    let maxMutations = Math.max(1, rod?.comboMutations || 1);
    let mutationList = mutationChance(mutations, maxMutations, baseMutationLuck);

    if (mutationList.length === 0) {
        mutationList = ["Normal"];
    } else {
        const totalMultiplier = mutationList.reduce(
            (mult, key) => mult * (mutations[key]?.multiplier || 1),
            1
        );
        totalPrice = Math.round(totalPrice * totalMultiplier);
    }

    if (enchant?.effect?.sellValue) totalPrice = Math.round(totalPrice * enchant.effect.sellValue);
    if (enchant?.effect?.sellMultiplier) totalPrice = Math.round(totalPrice * enchant.effect.sellMultiplier);
    
    const rodSellMultiplier = 1 + (rod?.sellMultiplier || 0);
    totalPrice = Math.round(totalPrice * rodSellMultiplier);
    
    let progressSpeedMultiplier = 1;
    if (enchant?.effect?.progressSpeed) progressSpeedMultiplier *= enchant.effect.progressSpeed;
    if (enchant?.effect?.progressSpeedChance) {
        let chanceHigh = enchant.effect.progressSpeedChance[0];
        let lowValue = enchant.effect.progressSpeedChance[1];
        progressSpeedMultiplier *= Math.random() < chanceHigh ? 1.9 : 1 + lowValue;
    }

    if (enchant?.effect?.perPerfectCatch && perfectCatch) {
        progressSpeedMultiplier += enchant.effect.perPerfectCatch;
        if (enchant?.effect?.maxBonus) progressSpeedMultiplier = Math.min(progressSpeedMultiplier, 1 + enchant.effect.maxBonus);
    }
    if (enchant?.effect?.perRegularCatch && !perfectCatch) {
        progressSpeedMultiplier += enchant.effect.perRegularCatch;
        if (enchant?.effect?.maxBonus) progressSpeedMultiplier = Math.max(progressSpeedMultiplier, 1);
    }

    return {
        name: chosen.name,
        rarity: chosen.rarity,
        type: "fish",
        kg: weight,
        pricePerKg: chosen.avgValue,
        price: totalPrice,
        mutations: mutationList,
        isMutated: mutationList.length > 0 && !(mutationList.length === 1 && mutationList[0] === "Normal"),
        progressSpeedMultiplier
    };
}

function generateId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function similarity(a, b) {
    let longer = a.length > b.length ? a : b;
    let shorter = a.length > b.length ? b : a;
    let longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();

    let costs = new Array();
    for (let i = 0; i <= a.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= b.length; j++) {
            if (i === 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (a.charAt(i - 1) !== b.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[b.length] = lastValue;
    }
    return costs[b.length];
}

async function findUserByIdOrName(query) {
    let user = null;

    if (!isNaN(query)) {
        user = await Player.findOne({ id: Number(query) });
    }

    if (!user) {
        user = await Player.findOne({ username: query });
    }

    return user;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateConnectID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function formatMoney(number) {
    if (number === null || number === undefined || isNaN(number)) return "0";
    const n = Number(number);
    if (n === 0) return "0";
    const suffixes = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qd', 'Qid', 'Sxd', 'Spd', 'Od', 'Nd', 'Vg'];
    let tier = Math.floor(Math.log10(Math.abs(n)) / 3);
    if (tier >= suffixes.length) tier = suffixes.length - 1;
    if (tier < 0) return n.toFixed(2);
    const scale = Math.pow(10, tier * 3);
    return (Math.round(n / scale * 100) / 100) + suffixes[tier];
}

function parseAmount(text) {
    const units = { K:1e3, M:1e6, B:1e9, T:1e12, QA:1e15, QI:1e18, SX:1e21, SP:1e24, OC:1e27, NO:1e30 };
    const m = String(text).toUpperCase().match(/^([\d.,]+)([A-Z]*)$/);
    if (!m) return NaN;
    let num = parseFloat(m[1].replace(/,/g, ''));
    if (units[m[2]]) num *= units[m[2]];
    return Math.floor(num);
}

function doGachaPull(user) {
    const isPity = (user.gachaPity || 0) >= GACHA_PITY_LIMIT;
    const pool = isPity
        ? GACHA_POOL.filter(x => x.rarity === 'ssr')
        : GACHA_POOL;
    const totalW = pool.reduce((a, b) => a + b.weight, 0);
    let roll = Math.random() * totalW, acc = 0;
    let item = pool[0];
    for (const p of pool) { acc += p.weight; if (roll <= acc) { item = p; break; } }
    const isSSR = item.rarity === 'ssr';
    user.gachaPity = isSSR ? 0 : (user.gachaPity || 0) + 1;
    return { item, isSSR, pity: isPity };
}

function addSeasonPoints(user, fish) {
    const extras = SEASON_CONFIG.pointsPerRareFish;
    const pts = extras[fish.rarity] || SEASON_CONFIG.pointsPerFish;
    user.seasonPoints = (user.seasonPoints || 0) + pts;
    if (fish.mutations && fish.mutations.some(m => m !== 'Normal')) {
        user.seasonPoints += SEASON_CONFIG.pointsPerMutation;
    }
    return pts;
}

function getUpgradedStats(user, rod) {
    const luckBonus  = UPGRADES.luck.effect(user.luckUpgrade || 0);
    const speedBonus = UPGRADES.speed.effect(user.speedUpgrade || 0);
    const sellBonus  = UPGRADES.sell.effect(user.sellUpgrade || 0);
    const prestigeBonus = (user.prestige || 0) * 0.05;

    // Cek bait aktif di inventory
    const bait = (user.inventory || []).find(i => i.type === 'bait');
    const baitLuck = bait?.id === 'goldbait' ? 0.3 : bait?.id === 'crystalbait' ? 0.6 : 0;
    const baitSell = bait?.id === 'crystalbait' ? 0.5 : 0;

    return {
        luck: (rod.luck || 0) + luckBonus + prestigeBonus + baitLuck,
        speed: Math.min((rod.speed || 0) + speedBonus, 0.98),
        sellMultiplier: (rod.sellMultiplier || 0) + sellBonus + baitSell,
        activeBait: bait || null,
    };
}

// ===== ISLANDS DATA =====

const islands = {
mousewood: {
  name: "Mousewood",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/c/cb/MoosewoodVillage.png/500px-MoosewoodVillage.png",
  listFish: [
    { name: "Red Snapper", rarity: "common", avgValue: 35, minKg: 1, maxKg: 4 },
    { name: "Largemouth Bass", rarity: "common", avgValue: 44, minKg: 2.75, maxKg: 5.6 },
    { name: "Trout", rarity: "common", avgValue: 52, minKg: 2.95, maxKg: 7.1 },
    { name: "Anchovy", rarity: "common", avgValue: 80, minKg: 2, maxKg: 8 },
    { name: "Bream", rarity: "common", avgValue: 62, minKg: 1.9, maxKg: 6.1 },
    { name: "Sockeye Salmon", rarity: "uncommon", avgValue: 210, minKg: 4.5, maxKg: 28.9 },
    { name: "Yellowfin Tuna", rarity: "uncommon", avgValue: 180, minKg: 2, maxKg: 6.9 },
    { name: "Carp", rarity: "uncommon", avgValue: 265, minKg: 3, maxKg: 12 },
    { name: "Goldfish", rarity: "uncommon", avgValue: 310, minKg: 0.90, maxKg: 8 },
    { name: "Snook", rarity: "rare", avgValue: 600, minKg: 5, maxKg: 78.6 },
    { name: "Flounder", rarity: "rare", avgValue: 640, minKg: 3.5, maxKg: 76.4 },
    { name: "Eel", rarity: "rare", avgValue: 710, minKg: 2.65, maxKg: 76.6 },
    { name: "Pike", rarity: "epic", avgValue: 2800, minKg: 2.35, maxKg: 154.4 },
    { name: "Whiptail Catfish", rarity: "epic", avgValue: 4200, minKg: 2, maxKg: 400 },
    { name: "Whisker Bill", rarity: "mythic", avgValue: 9500, minKg: 31, maxKg: 67.5 },
    { name: "Mudskipper", rarity: "rare", avgValue: 780, minKg: 0.5, maxKg: 12 },
    { name: "Treble Bass", rarity: "exotic", avgValue: 26000, minKg: 2.75, maxKg: 2444.4 },
    { name: "Mossy Turtle", rarity: "epic", avgValue: 3600, minKg: 4, maxKg: 80 },
    { name: "Ironback Carp", rarity: "mythic", avgValue: 11000, minKg: 20, maxKg: 90 },
    { name: "Ancient Gudgeon", rarity: "legendary", avgValue: 55000, minKg: 8, maxKg: 120 },
    { name: "Phantom Trout", rarity: "godly", avgValue: 140000, minKg: 15, maxKg: 200 },
    { name: "Spirit Bass", rarity: "secret", avgValue: 420000, minKg: 30, maxKg: 800 },
  ],
},
roslitbay: {
  name: "Roslit Bay",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/3/32/RoslitFar.png/380px-RoslitFar.png",
  listFish: [
  { name: "Minnow", rarity: "common", avgValue: 200, minKg: 1, maxKg: 26.3 },
  { name: "Perch", rarity: "common", avgValue: 225, minKg: 1, maxKg: 40.8 },
  { name: "Chub", rarity: "common", avgValue: 215, minKg: 2, maxKg: 26.7 },
  { name: "Pearl", rarity: "uncommon", avgValue: 390, minKg: 1, maxKg: 37.5 },
  { name: "Butterflyfish", rarity: "uncommon", avgValue: 450, minKg: 0.85, maxKg: 62.3 },
  { name: "Clownfish", rarity: "uncommon", avgValue: 425, minKg: 0.35, maxKg: 52.5 },
  { name: "Pumpkinseed", rarity: "uncommon", avgValue: 475, minKg: 0.3, maxKg: 54 },
  { name: "Blue Tang", rarity: "rare", avgValue: 850, minKg: 1, maxKg: 54 },
  { name: "Rose Pearl", rarity: "rare", avgValue: 1250, minKg: 1, maxKg: 90.6 },
  { name: "Ribbon Eel", rarity: "epic", avgValue: 2100, minKg: 7.75, maxKg: 77.5 },
  { name: "Clam", rarity: "epic", avgValue: 2000, minKg: 1, maxKg: 12.4 },
  { name: "Yellow Boxfish", rarity: "epic", avgValue: 2300, minKg: 1.25, maxKg: 87.5 },
  { name: "Squid", rarity: "legendary", avgValue: 6000, minKg: 1.5, maxKg: 84 },
  { name: "Angelfish", rarity: "legendary", avgValue: 6250, minKg: 1.25, maxKg: 75 },
  { name: "Gilded Pearl", rarity: "legendary", avgValue: 6500, minKg: 1, maxKg: 75 },
  { name: "Alligator Gar", rarity: "mythic", avgValue: 15000, minKg: 32.5, maxKg: 158.9 },
  { name: "Mauve Pearl", rarity: "mythic", avgValue: 16000, minKg: 1, maxKg: 125 },
  { name: "Suckermouth Catfish", rarity: "mythic", avgValue: 17500, minKg: 13.25, maxKg: 124.7 },
  { name: "Arapaima", rarity: "godly", avgValue: 30000, minKg: 150, maxKg: 187.5 },
  { name: "Dumbo Octopus", rarity: "godly", avgValue: 35000, minKg: 2.75, maxKg: 618.8 },
  { name: "Deep Pearl", rarity: "godly", avgValue: 40000, minKg: 1, maxKg: 550 },
  { name: "Axolotl", rarity: "secret", avgValue: 75000, minKg: 1, maxKg: 666.7 },
  { name: "Aurora Pearl", rarity: "secret", avgValue: 100000, minKg: 1, maxKg: 1406.3 },
  { name: "Manta Ray", rarity: "secret", avgValue: 125000, minKg: 887.5, maxKg: 2662.5 },
  { name: "Golden Sea Pearl", rarity: "secret", avgValue: 150000, minKg: 1, maxKg: 2187.5 },
  { name: "Mimic Octopus", rarity: "rare", avgValue: 1100, minKg: 0.5, maxKg: 15 },
  { name: "Crown Jellyfish", rarity: "epic", avgValue: 2600, minKg: 2, maxKg: 40 },
  { name: "Ruby Eel", rarity: "legendary", avgValue: 7500, minKg: 5, maxKg: 90 },
  { name: "Abyssal Lanternfish", rarity: "mythic", avgValue: 18000, minKg: 3, maxKg: 60 },
  { name: "Prismatic Ray", rarity: "godly", avgValue: 42000, minKg: 20, maxKg: 300 },
  { name: "Void Eel", rarity: "secret", avgValue: 180000, minKg: 5, maxKg: 1000 },
]
},
mushgroveswamp: {
  name: "Mushgrove Swamp",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/e/ef/MushgroveFar.png/380px-MushgroveFar.png",
  listFish: [
    { name: "Fungal Cluster", rarity: "common", avgValue: 1400, minKg: 1, maxKg: 4 },
    { name: "Swamp Bass", rarity: "common", avgValue: 1680, minKg: 1, maxKg: 4 },
    { name: "White Perch", rarity: "uncommon", avgValue: 1960, minKg: 1.2, maxKg: 5 },
    { name: "Grey Carp", rarity: "uncommon", avgValue: 2240, minKg: 1, maxKg: 4.5 },
    { name: "Bowfin", rarity: "rare", avgValue: 4200, minKg: 1, maxKg: 4.5 },
    { name: "Swamp Scallop", rarity: "rare", avgValue: 5600, minKg: 1, maxKg: 1 },
    { name: "Marsh Gar", rarity: "epic", avgValue: 12600, minKg: 1, maxKg: 27.5 },
    { name: "Diamond Catfish", rarity: "epic", avgValue: 14000, minKg: 1, maxKg: 10 },
    { name: "Mushgrove Crab", rarity: "legendary", avgValue: 32200, minKg: 1, maxKg: 1 },
    { name: "Alligator", rarity: "mythic", avgValue: 68600, minKg: 1, maxKg: 225 },
    { name: "Handfish", rarity: "godly", avgValue: 156800, minKg: 1, maxKg: 9 },
    { name: "RocketFuel", rarity: "secret", avgValue: 518000, minKg: 5, maxKg: 1.25 },
    { name: "Resin", rarity: "secret", avgValue: 560000, minKg: 1, maxKg: 7 },
    { name: "Swamp Sprite", rarity: "uncommon", avgValue: 2000, minKg: 0.5, maxKg: 10 },
    { name: "Bog Turtle", rarity: "rare", avgValue: 4800, minKg: 2, maxKg: 30 },
    { name: "Toxic Frog", rarity: "epic", avgValue: 13000, minKg: 0.2, maxKg: 5 },
    { name: "Swamp Leviathan", rarity: "legendary", avgValue: 38000, minKg: 50, maxKg: 500 },
    { name: "Fungal Serpent", rarity: "mythic", avgValue: 75000, minKg: 20, maxKg: 200 },
    { name: "Spore Dragon", rarity: "godly", avgValue: 165000, minKg: 80, maxKg: 600 },
  ],
},
terrapinisland: {
  name: "Terrapin Island",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/3/39/TerrapinFar.png/550px-TerrapinFar.png",
  listFish: [
    { name: "Largemouth Bass", rarity: "common", avgValue: 3400, minKg: 2.75, maxKg: 51.9 },
    { name: "Sea Bass", rarity: "uncommon", avgValue: 3800, minKg: 4, maxKg: 63.3 },
    { name: "Gudgeon", rarity: "rare", avgValue: 6400, minKg: 0.2, maxKg: 26.7 },
    { name: "Smallmouth Bass", rarity: "rare", avgValue: 7800, minKg: 1.1, maxKg: 45.3 },
    { name: "Walleye", rarity: "epic", avgValue: 14500, minKg: 2.9, maxKg: 65.3 },
    { name: "White Bass", rarity: "legendary", avgValue: 41200, minKg: 1.4, maxKg: 61.6 },
    { name: "Redeye Bass", rarity: "mythic", avgValue: 72400, minKg: 0.9, maxKg: 69 },
    { name: "Chinook Salmon", rarity: "mythic", avgValue: 81200, minKg: 25, maxKg: 143.8 },
    { name: "Golden Smallmouth Bass", rarity: "godly", avgValue: 182000, minKg: 3, maxKg: 466.7 },
    { name: "Sea Turtle", rarity: "godly", avgValue: 236000, minKg: 110, maxKg: 1466.7 },
    { name: "Manatee", rarity: "secret", avgValue: 580000, minKg: 150, maxKg: 2400 },
    { name: "Shell Crab", rarity: "uncommon", avgValue: 3600, minKg: 0.5, maxKg: 8 },
    { name: "Coral Snapper", rarity: "rare", avgValue: 7000, minKg: 2, maxKg: 50 },
    { name: "Gilded Turtle", rarity: "epic", avgValue: 16000, minKg: 10, maxKg: 100 },
    { name: "Island Leviathan", rarity: "legendary", avgValue: 45000, minKg: 100, maxKg: 800 },
    { name: "Apex Hammerhead", rarity: "mythic", avgValue: 85000, minKg: 80, maxKg: 250 },
    { name: "Celestial Turtle", rarity: "godly", avgValue: 250000, minKg: 150, maxKg: 1200 },
  ],
},
theocean: {
  name: "The Ocean",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/8/89/Ocean.png/550px-Ocean.png",
  listFish: [
    { name: "Tire", rarity: "common", avgValue: 3600, minKg: 11, maxKg: 20 },
    { name: "Seaweed", rarity: "common", avgValue: 4400, minKg: 0.2, maxKg: 6 },
    { name: "Mackerel", rarity: "uncommon", avgValue: 6200, minKg: 2.5, maxKg: 46.9 },
    { name: "Mullet", rarity: "uncommon", avgValue: 6800, minKg: 1.25, maxKg: 56.3 },
    { name: "Gold Sea Bass", rarity: "uncommon", avgValue: 7100, minKg: 4, maxKg: 63.3 },
    { name: "Sardine", rarity: "uncommon", avgValue: 7800, minKg: 0.2, maxKg: 20 },
    { name: "Porgy", rarity: "uncommon", avgValue: 8600, minKg: 1.75, maxKg: 52.5 },
    { name: "Haddock", rarity: "rare", avgValue: 9800, minKg: 2.75, maxKg: 34.4 },
    { name: "Salmon", rarity: "rare", avgValue: 10200, minKg: 7, maxKg: 91 },
    { name: "Gold Yellowfin Tuna", rarity: "rare", avgValue: 12600, minKg: 90.5, maxKg: 79.9 },
    { name: "Amberjack", rarity: "rare", avgValue: 13400, minKg: 30, maxKg: 86.3 },
    { name: "Gold Cod", rarity: "epic", avgValue: 18600, minKg: 6, maxKg: 54 },
    { name: "Gold Fish Barrel", rarity: "epic", avgValue: 21000, minKg: 15, maxKg: 80 },
    { name: "Barracuda", rarity: "epic", avgValue: 22500, minKg: 8.25, maxKg: 112.5 },
    { name: "Nurse Shark", rarity: "legendary", avgValue: 65400, minKg: 125, maxKg: 166.7 },
    { name: "Diamond Swordfish", rarity: "mythic", avgValue: 98200, minKg: 175, maxKg: 595 },
    { name: "Bluefin Tuna", rarity: "mythic", avgValue: 128000, minKg: 160, maxKg: 254.5 },
    { name: "Stingray", rarity: "mythic", avgValue: 134000, minKg: 22.5, maxKg: 172.5 },
    { name: "Halibut", rarity: "mythic", avgValue: 142000, minKg: 150, maxKg: 187.5 },
    { name: "Sailfish", rarity: "godly", avgValue: 268000, minKg: 50, maxKg: 666.7 },
    { name: "Pufferfish", rarity: "godly", avgValue: 288000, minKg: 1.25, maxKg: 143.8 },
    { name: "Dolphin", rarity: "godly", avgValue: 324000, minKg: 175, maxKg: 1050 },
    { name: "Flying Fish", rarity: "godly", avgValue: 356000, minKg: 3.25, maxKg: 780 },
    { name: "Crown Bass", rarity: "godly", avgValue: 382000, minKg: 4, maxKg: 800 },
    { name: "Moonfish", rarity: "godly", avgValue: 394000, minKg: 375, maxKg: 1350 },
    { name: "Sawfish", rarity: "secret", avgValue: 564000, minKg: 500, maxKg: 1250 },
    { name: "Sea Pickle", rarity: "secret", avgValue: 582000, minKg: 0.7, maxKg: 1400 },
    { name: "Mythic Fish", rarity: "secret", avgValue: 620000, minKg: 1, maxKg: 1428.6 },
    { name: "Mustard", rarity: "secret", avgValue: 712000, minKg: 2.5, maxKg: 11875 },
    { name: "Long Pike", rarity: "secret", avgValue: 742000, minKg: 2.35, maxKg: 12085.7 },
    { name: "Megalodon", rarity: "extinct", avgValue: 3280000, minKg: 50000, maxKg: 110000 },
    { name: "Oarfish", rarity: "rare", avgValue: 11000, minKg: 10, maxKg: 80 },
    { name: "Fangtooth", rarity: "epic", avgValue: 20000, minKg: 0.5, maxKg: 30 },
    { name: "Viperfish", rarity: "epic", avgValue: 22000, minKg: 1, maxKg: 40 },
    { name: "Ocean Chimera", rarity: "legendary", avgValue: 70000, minKg: 30, maxKg: 400 },
    { name: "Abyssal Angler", rarity: "mythic", avgValue: 140000, minKg: 5, maxKg: 200 },
    { name: "Titanfish", rarity: "godly", avgValue: 400000, minKg: 200, maxKg: 2000 },
    { name: "Void Shark", rarity: "secret", avgValue: 800000, minKg: 500, maxKg: 5000 },
    { name: "Primordial Whale", rarity: "extinct", avgValue: 5000000, minKg: 80000, maxKg: 200000 },
  ],
},
atlantis: {
  name: "Atlantis",
  image: "https://static.wikitide.net/fischwiki/thumb/e/ee/Atlantis.png/550px-Atlantis.png",
  listFish: [
    { name: "Voltfin Carp", rarity: "common", avgValue: 2520, minKg: 17.5, maxKg: 126 },
    { name: "Aqua Scribe", rarity: "common", avgValue: 818, minKg: 0.75, maxKg: 40.9 },
    { name: "Neptune's Nibbler", rarity: "common", avgValue: 600, minKg: 1, maxKg: 30 },
    { name: "Atlantean Sardine", rarity: "common", avgValue: 456, minKg: 0.65, maxKg: 22.8 },
    { name: "Column Crawler", rarity: "common", avgValue: 780, minKg: 0.85, maxKg: 39 },
    { name: "Lightning Minnow", rarity: "uncommon", avgValue: 3200, minKg: 1, maxKg: 80 },
    { name: "Poseidon's Perch", rarity: "uncommon", avgValue: 1960, minKg: 1.75, maxKg: 49 },
    { name: "Sunken Silverscale", rarity: "uncommon", avgValue: 1672, minKg: 0.9, maxKg: 41.8 },
    { name: "Sparkfin Tetra", rarity: "uncommon", avgValue: 2552, minKg: 8.5, maxKg: 63.8 },
    { name: "Atlantean Anchovy", rarity: "uncommon", avgValue: 1000, minKg: 0.5, maxKg: 25 },
    { name: "Oracle Minnow", rarity: "uncommon", avgValue: 1284, minKg: 0.45, maxKg: 32.1 },
    { name: "Tentacled Horror", rarity: "rare", avgValue: 21250, minKg: 8.5, maxKg: 212.5 },
    { name: "Mosaic Swimmer", rarity: "rare", avgValue: 11250, minKg: 3, maxKg: 112.5 },
    { name: "Static Ray", rarity: "rare", avgValue: 21000, minKg: 22.5, maxKg: 210 },
    { name: "Shadowfang Snapper", rarity: "rare", avgValue: 14000, minKg: 3.5, maxKg: 140 },
    { name: "Echo Fisher", rarity: "rare", avgValue: 13880, minKg: 4.75, maxKg: 138.8 },
    { name: "Marble Maiden", rarity: "rare", avgValue: 8570, minKg: 2.5, maxKg: 85.7 },
    { name: "Titan Tuna", rarity: "epic", avgValue: 31420, minKg: 5, maxKg: 157.1 },
    { name: "Colossal Carp", rarity: "epic", avgValue: 25200, minKg: 3.5, maxKg: 126 },
    { name: "Temple Drifter", rarity: "epic", avgValue: 24720, minKg: 4, maxKg: 123.6 },
    { name: "Crystal Chorus", rarity: "epic", avgValue: 24000, minKg: 3.75, maxKg: 120 },
    { name: "Helios Ray", rarity: "epic", avgValue: 27000, minKg: 4.5, maxKg: 135 },
    { name: "Atlantean Guardian", rarity: "epic", avgValue: 37500, minKg: 6, maxKg: 187.5 },
    { name: "Oracle's Eye", rarity: "legendary", avgValue: 157500, minKg: 6.75, maxKg: 262.5 },
    { name: "Tentacle Eel", rarity: "legendary", avgValue: 202500, minKg: 15, maxKg: 337.5 },
    { name: "Thunder Bass", rarity: "legendary", avgValue: 202500, minKg: 45, maxKg: 337.5 },
    { name: "Philosopher's Fish", rarity: "legendary", avgValue: 135000, minKg: 5.25, maxKg: 225 },
    { name: "Giant Manta", rarity: "legendary", avgValue: 157500, minKg: 9, maxKg: 262.5 },
    { name: "Leviathan Bass", rarity: "legendary", avgValue: 180000, minKg: 12, maxKg: 300 },
    { name: "Storm Eel", rarity: "legendary", avgValue: 247500, minKg: 60, maxKg: 412.5 },
    { name: "Siren Singer", rarity: "legendary", avgValue: 174000, minKg: 7.25, maxKg: 290 },
    { name: "Chronos Deep Swimmer", rarity: "legendary", avgValue: 186000, minKg: 7.75, maxKg: 310 },
    { name: "Starlit Weaver", rarity: "mythic", avgValue: 305859, minKg: 30, maxKg: 600 },
    { name: "Massive Marlin", rarity: "mythic", avgValue: 221000, minKg: 32.5, maxKg: 577.8 },
    { name: "Triton's Herald", rarity: "mythic", avgValue: 203390, minKg: 15, maxKg: 375 },
    { name: "Deep One", rarity: "mythic", avgValue: 230399, minKg: 32.5, maxKg: 650 },
    { name: "Atlantean Alchemist", rarity: "mythic", avgValue: 720000, minKg: 30, maxKg: 600 },
    { name: "Eldritch Horror", rarity: "mythic", avgValue: 304900, minKg: 60, maxKg: 900 },
    { name: "Voidscale Guppy", rarity: "mythic", avgValue: 340000, minKg: 22.5, maxKg: 487.5 },
    { name: "Lightning Pike", rarity: "mythic", avgValue: 239160, minKg: 32.5, maxKg: 199.3 },
    { name: "Stormcloud Angelfish", rarity: "mythic", avgValue: 279000, minKg: 90, maxKg: 232.5 },
    { name: "Titanic Sturgeon", rarity: "mythic", avgValue: 430099, minKg: 37.5, maxKg: 675 },
    { name: "Titanfang Grouper", rarity: "mythic", avgValue: 349580, minKg: 45, maxKg: 750 },
    { name: "Twilight Glowfish", rarity: "mythic", avgValue: 495000, minKg: 22.5, maxKg: 487.5 },
    { name: "Mage Marlin", rarity: "mythic", avgValue: 225000, minKg: 150, maxKg: 1875 },
    { name: "Abyssal King", rarity: "legendary", avgValue: 578490, minKg: 450, maxKg: 3000 },
    { name: "Deep Behemoth", rarity: "legendary", avgValue: 759000, minKg: 450, maxKg: 3000 },
    { name: "Deep Emperor", rarity: "legendary", avgValue: 598400, minKg: 375, maxKg: 2250 },
    { name: "Deep Crownfish", rarity: "legendary", avgValue: 640000, minKg: 75, maxKg: 1500 },
    { name: "Kraken's Herald", rarity: "legendary", avgValue: 750900, minKg: 375, maxKg: 2250 },
    { name: "Thunder Serpent", rarity: "legendary", avgValue: 820000, minKg: 150, maxKg: 1875 },
    { name: "Abyssal Devourer", rarity: "godly", avgValue: 1440000, minKg: 1800, maxKg: 6000 },
    { name: "Void Emperor", rarity: "godly", avgValue: 1140000, minKg: 950, maxKg: 4750 },
    { name: "Celestial Koi", rarity: "godly", avgValue: 1440000, minKg: 750, maxKg: 6000 },
    { name: "Zeus' Herald", rarity: "godly", avgValue: 1109900, minKg: 225, maxKg: 3750 },
    { name: "King Jellyfish", rarity: "godly", avgValue: 1002900, minKg: 400, maxKg: 2800 },
    { name: "Abyssal Goliath", rarity: "godly", avgValue: 1140000, minKg: 950, maxKg: 4750 },
    { name: "The Kraken", rarity: "extinct", avgValue: 5120000, minKg: 12777.8, maxKg: 112000 },
    { name: "Ancient Kraken", rarity: "special", avgValue: 10500000, minKg: 35000, maxKg: 175000 }
  ],
},
// ── NEW ISLANDS ─────────────────────────────────
volcanicdepths: {
  name: "Volcanic Depths",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/e/ef/MushgroveFar.png/380px-MushgroveFar.png",
  listFish: [
    { name: "Lava Minnow", rarity: "common", avgValue: 8000, minKg: 0.5, maxKg: 10 },
    { name: "Ember Bass", rarity: "common", avgValue: 9500, minKg: 1, maxKg: 15 },
    { name: "Scorched Perch", rarity: "uncommon", avgValue: 16000, minKg: 2, maxKg: 30 },
    { name: "Magma Eel", rarity: "uncommon", avgValue: 19000, minKg: 3, maxKg: 50 },
    { name: "Volcanic Carp", rarity: "uncommon", avgValue: 22000, minKg: 2, maxKg: 40 },
    { name: "Flame Snapper", rarity: "rare", avgValue: 35000, minKg: 5, maxKg: 80 },
    { name: "Obsidian Catfish", rarity: "rare", avgValue: 42000, minKg: 8, maxKg: 120 },
    { name: "Ash Pike", rarity: "rare", avgValue: 48000, minKg: 6, maxKg: 100 },
    { name: "Inferno Barracuda", rarity: "epic", avgValue: 90000, minKg: 15, maxKg: 200 },
    { name: "Molten Ray", rarity: "epic", avgValue: 105000, minKg: 20, maxKg: 250 },
    { name: "Magma Shark", rarity: "legendary", avgValue: 280000, minKg: 80, maxKg: 600 },
    { name: "Pyroclastic Bass", rarity: "legendary", avgValue: 320000, minKg: 60, maxKg: 500 },
    { name: "Ember Leviathan", rarity: "mythic", avgValue: 750000, minKg: 200, maxKg: 1500 },
    { name: "Caldera Titan", rarity: "mythic", avgValue: 900000, minKg: 300, maxKg: 2000 },
    { name: "Volcano God", rarity: "godly", avgValue: 2500000, minKg: 1000, maxKg: 5000 },
    { name: "Phoenix Fish", rarity: "godly", avgValue: 2800000, minKg: 500, maxKg: 4000 },
    { name: "Lava Drake", rarity: "secret", avgValue: 6500000, minKg: 2000, maxKg: 15000 },
    { name: "Eternal Flame Carp", rarity: "secret", avgValue: 8000000, minKg: 3000, maxKg: 20000 },
    { name: "Primordial Inferno", rarity: "extinct", avgValue: 25000000, minKg: 100000, maxKg: 300000 },
  ],
},
crystalcaves: {
  name: "Crystal Caves",
  image: "https://images.weserv.nl/?url=static.wikitide.net/fischwiki/thumb/3/39/TerrapinFar.png/550px-TerrapinFar.png",
  listFish: [
    { name: "Glowfin Minnow", rarity: "common", avgValue: 25000, minKg: 0.3, maxKg: 8 },
    { name: "Crystal Chub", rarity: "common", avgValue: 28000, minKg: 0.5, maxKg: 12 },
    { name: "Prism Perch", rarity: "uncommon", avgValue: 55000, minKg: 1, maxKg: 25 },
    { name: "Gem Carp", rarity: "uncommon", avgValue: 65000, minKg: 2, maxKg: 35 },
    { name: "Cave Eel", rarity: "uncommon", avgValue: 72000, minKg: 1, maxKg: 30 },
    { name: "Diamond Trout", rarity: "rare", avgValue: 120000, minKg: 3, maxKg: 60 },
    { name: "Sapphire Bass", rarity: "rare", avgValue: 140000, minKg: 4, maxKg: 80 },
    { name: "Emerald Snapper", rarity: "rare", avgValue: 160000, minKg: 5, maxKg: 100 },
    { name: "Quartz Catfish", rarity: "epic", avgValue: 350000, minKg: 15, maxKg: 200 },
    { name: "Amethyst Ray", rarity: "epic", avgValue: 400000, minKg: 20, maxKg: 250 },
    { name: "Crystal Serpent", rarity: "legendary", avgValue: 900000, minKg: 50, maxKg: 500 },
    { name: "Topaz Leviathan", rarity: "legendary", avgValue: 1100000, minKg: 80, maxKg: 700 },
    { name: "Obsidian Dragon", rarity: "mythic", avgValue: 2800000, minKg: 200, maxKg: 2000 },
    { name: "Prismatic Titan", rarity: "mythic", avgValue: 3500000, minKg: 300, maxKg: 3000 },
    { name: "Crystal God", rarity: "godly", avgValue: 9000000, minKg: 1000, maxKg: 8000 },
    { name: "Eternal Prism", rarity: "godly", avgValue: 11000000, minKg: 1500, maxKg: 12000 },
    { name: "Void Crystal", rarity: "secret", avgValue: 28000000, minKg: 5000, maxKg: 30000 },
    { name: "Absolute Diamond", rarity: "secret", avgValue: 40000000, minKg: 8000, maxKg: 50000 },
    { name: "Genesis Stone", rarity: "extinct", avgValue: 120000000, minKg: 200000, maxKg: 1000000 },
  ],
},
};




// ══════════════════════════════════════════════════════════════
//   TRAVEL REQUIREMENTS — syarat unlock tiap pulau
// ══════════════════════════════════════════════════════════════
const travelRequirements = {
    mousewood:       null,                               // starter island - gratis
    roslitbay:       { money: 5_000,       fish: 5   }, // mudah
    mushgroveswamp:  { money: 25_000,      fish: 20  },
    terrapinisland:  { money: 100_000,     fish: 50  },
    theocean:        { money: 1_000_000,   fish: 100 },
    atlantis:        { money: 10_000_000,  fish: 200 },
    volcaniddepths:  { money: 100_000_000, fish: 400 },
    crystalcaves:    { money: 1_000_000_000, fish: 750 },
};

// ===== FISHING ROD CATALOG =====
// Ini adalah daftar semua rod yang tersedia di game
const fishingRod = {
    basicrod: {
        name: "Basic Fishing Rod",
        type: "rod",
        luck: 0.00,
        speed: 0.00,
        comboFish: 1,
        comboMutations: 1,
        mutationsLuck: 0.000,
        sellMultiplier: 0,
        price: 0, // tidak dijual — default rod
        enchant: null,
        bonusStats: {},
        description: "Pancingan standar untuk pemula.",
        level: 1,
        maxLevel: 5,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    ironrod: {
        name: "Iron Rod",
        type: "rod",
        luck: 0.02,
        speed: 0.03,
        comboFish: 1,
        comboMutations: 1,
        mutationsLuck: 0.001,
        sellMultiplier: 0.05,
        price: 25000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan besi yang lebih kuat dari basic rod.",
        level: 1,
        maxLevel: 10,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    goldrod: {
        name: "Gold Rod",
        type: "rod",
        luck: 0.06,
        speed: 0.07,
        comboFish: 1,
        comboMutations: 1,
        mutationsLuck: 0.003,
        sellMultiplier: 0.15,
        price: 250000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan emas dengan luck lebih tinggi.",
        level: 1,
        maxLevel: 15,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    diamondrod: {
        name: "Diamond Rod",
        type: "rod",
        luck: 0.12,
        speed: 0.13,
        comboFish: 2,
        comboMutations: 1,
        mutationsLuck: 0.007,
        sellMultiplier: 0.30,
        price: 2500000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan berlian — combo ikan meningkat.",
        level: 1,
        maxLevel: 20,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    ancientrod: {
        name: "Ancient Rod",
        type: "rod",
        luck: 0.20,
        speed: 0.20,
        comboFish: 2,
        comboMutations: 2,
        mutationsLuck: 0.015,
        sellMultiplier: 0.50,
        price: 25000000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan kuno dari zaman dahulu — mutasi combo meningkat.",
        level: 1,
        maxLevel: 25,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    mythicrod: {
        name: "Mythic Rod",
        type: "rod",
        luck: 0.30,
        speed: 0.28,
        comboFish: 3,
        comboMutations: 2,
        mutationsLuck: 0.025,
        sellMultiplier: 0.75,
        price: 250000000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan mythic — memanggil ikan langka.",
        level: 1,
        maxLevel: 30,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    legendaryrod: {
        name: "Legendary Rod",
        type: "rod",
        luck: 0.42,
        speed: 0.38,
        comboFish: 3,
        comboMutations: 3,
        mutationsLuck: 0.040,
        sellMultiplier: 1.00,
        price: 2500000000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan legenda — combo penuh & sell bonus besar.",
        level: 1,
        maxLevel: 40,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    depthseekerrod: {
        name: "Depthseeker Rod",
        type: "rod",
        luck: 0.55,
        speed: 0.48,
        comboFish: 4,
        comboMutations: 3,
        mutationsLuck: 0.060,
        sellMultiplier: 1.30,
        price: 25000000000,
        enchant: null,
        bonusStats: {},
        description: "Pancingan penjelajah lautan dalam — luck & depth bonus.",
        level: 1,
        maxLevel: 50,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    voidrod: {
        name: "Void Rod",
        type: "rod",
        luck: 0.70,
        speed: 0.60,
        comboFish: 4,
        comboMutations: 4,
        mutationsLuck: 0.085,
        sellMultiplier: 1.75,
        price: 0, // hanya dari token store
        enchant: null,
        bonusStats: {},
        description: "Pancingan void — dari dimensi lain.",
        level: 1,
        maxLevel: 60,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    cosmicrod: {
        name: "Cosmic Rod",
        type: "rod",
        luck: 0.85,
        speed: 0.72,
        comboFish: 5,
        comboMutations: 4,
        mutationsLuck: 0.115,
        sellMultiplier: 2.20,
        price: 0, // hanya dari token store / season reward
        enchant: null,
        bonusStats: {},
        description: "Pancingan kosmik — kekuatan dari bintang-bintang.",
        level: 1,
        maxLevel: 75,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    prestigerod: {
        name: "Prestige Rod",
        type: "rod",
        luck: 0.95,
        speed: 0.80,
        comboFish: 5,
        comboMutations: 5,
        mutationsLuck: 0.150,
        sellMultiplier: 2.70,
        price: 0, // reward prestige
        enchant: null,
        bonusStats: {},
        description: "Pancingan prestige — hadiah bagi yang telah melampaui batas.",
        level: 1,
        maxLevel: 99,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
    },
    omegaRod: {
        name: "Omega Rod",
        type: "rod",
        luck: 1.20,
        speed: 0.90,
        comboFish: 6,
        comboMutations: 5,
        mutationsLuck: 0.200,
        sellMultiplier: 3.50,
        price: 0, // season champion reward
        enchant: null,
        bonusStats: {},
        description: "Pancingan omega — milik sang juara season.",
        level: 1,
        maxLevel: 99,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
        userSetting: "developer",
    },
    eternityrod: {
        name: "Eternity Rod",
        type: "rod",
        luck: 1.50,
        speed: 0.95,
        comboFish: 7,
        comboMutations: 6,
        mutationsLuck: 0.280,
        sellMultiplier: 5.00,
        price: 0, // prestige 5 reward
        enchant: null,
        bonusStats: {},
        description: "Pancingan keabadian — melampaui ruang dan waktu.",
        level: 1,
        maxLevel: 99,
        exp: 0,
        expToNextLevel: 100,
        enchantCount: 0,
        userSetting: "developer",
    },
};

// ===== ROD ENCHANTS =====

const rodEnchants = {
  swift: {
    name: "Swift",
    rarity: "common",
    effect: { lureSpeed: 1.3, progressSpeed: 1.05 },
    desc: "Mempercepat gerakan umpan dan progres menangkap ikan."
  },
  hasty: {
    name: "Hasty",
    rarity: "common",
    effect: { lureSpeed: 1.55 },
    desc: "Meningkatkan kecepatan umpan sehingga ikan lebih cepat tertarik."
  },
  blessedsong: {
    name: "Blessed Song",
    rarity: "common",
    effect: { progressSpeed: 1.4 },
    desc: "+40% Progress Speed"
  },
  agile: {
    name: "Agile",
    rarity: "common",
    effect: { progressSpeed: 1.1 },
    desc: "Meningkatkan kecepatan progress sedikit agar lebih efisien saat menangkap ikan."
  },
  buoyant: {
    name: "Buoyant",
    rarity: "common",
    effect: { lureSpeed: 1.2 },
    desc: "Meningkatkan kecepatan umpan di air, menarik ikan lebih cepat."
  },
  patient: {
    name: "Patient",
    rarity: "common",
    effect: { luck: 1.05 },
    desc: "Kesabaran menghasilkan hasil tangkapan yang sedikit lebih baik."
  },
  skilled: {
    name: "Skilled",
    rarity: "common",
    effect: { xpMultiplier: 1.25 },
    desc: "Memberikan sedikit tambahan XP setiap tangkapan."
  },
  divine: {
    name: "Divine",
    rarity: "rare",
    effect: { luck: 1.45, lureSpeed: 1.2 },
    desc: "Keberuntungan tinggi dan umpan bergerak lebih cepat."
  },
  clever: {
    name: "Clever",
    rarity: "rare",
    effect: { xpMultiplier: 2.25 },
    desc: "×2.25 XP dari semua hasil tangkapan"
  },
  tempered: {
    name: "Tempered",
    rarity: "rare",
    effect: { progressSpeed: 1.15, lureSpeed: 1.15 },
    desc: "Rod yang stabil dan responsif meningkatkan kecepatan dan kontrol."
  },
  frostbite: {
    name: "Frostbite",
    rarity: "rare",
    effect: { luck: 1.35, lureSpeed: 1.2 },
    desc: "Dingin es laut menenangkan ikan, membuat mereka lebih mudah tertangkap."
  },
  lucky: {
    name: "Lucky",
    rarity: "epic",
    effect: { luck: 1.2, lureSpeed: 1.15 },
    desc: "Menambah keberuntungan dan sedikit kecepatan umpan."
  },
  volcanic: {
    name: "Volcanic",
    rarity: "epic",
    effect: { luck: 1.7, sellMultiplier: 1.6 },
    desc: "Panas dari magma laut meningkatkan nilai ikan yang kamu tangkap."
  },
  coralblessing: {
    name: "Coral Blessing",
    rarity: "epic",
    effect: { xpMultiplier: 2.5, progressSpeed: 1.1 },
    desc: "Berkah terumbu karang memberi pengalaman dan progres lebih cepat."
  },
  deepcurrent: {
    name: "Deep Current",
    rarity: "epic",
    effect: { lureSpeed: 1.35, progressSpeed: 1.25 },
    desc: "Arus laut dalam mempercepat setiap gerakan dan hasil tangkapanmu."
  },
  quality: {
    name: "Quality",
    rarity: "epic",
    effect: { luck: 1.15, lureSpeed: 1.15, progressSpeed: 1.05 },
    desc: "Kombinasi keberuntungan, kecepatan umpan, dan progres menangkap ikan."
  },
  glittered: {
    name: "Glittered",
    rarity: "epic",
    effect: { mutationChance: 0.03 },
    desc: "Meningkatkan peluang mutasi 3%"
  },
  breezed: {
    name: "Breezed",
    rarity: "epic",
    effect: { luck: 1.65, lureSpeed: 1.1, progressSpeed: 1.2, mutationChance: 0.009 },
    desc: "+65% Luck, +10% Lure Speed, +20% Progress Speed, +0.9% Mutation chance"
  },
  mystical: {
    name: "Mystical",
    rarity: "epic",
    effect: { luck: 1.25, lureSpeed: 1.15, progressSpeed: 1.1 },
    desc: "+25% Luck, +15% Lure Speed, +10% Progress Speed "
  },
  harmonic: {
    name: "Harmonic",
    rarity: "epic",
    effect: { lureSpeed: 1.2, xpMultiplier: 1.75 },
    desc: "Keseimbangan sempurna antara kecepatan dan pengalaman."
  },
  dazzling: {
    name: "Dazzling",
    rarity: "epic",
    effect: { luck: 1.4, sellMultiplier: 1.5 },
    desc: "Kilauan rod menarik perhatian ikan berharga tinggi."
  },
  tidal: {
    name: "Tidal",
    rarity: "epic",
    effect: { luck: 1.25, progressSpeed: 1.25 },
    desc: "Mengalir seperti ombak — meningkatkan kecepatan dan keberuntungan."
  },
  enriched: {
    name: "Enriched",
    rarity: "epic",
    effect: { xpMultiplier: 2.0, progressSpeed: 1.05 },
    desc: "Pengalaman yang kaya memberikan XP lebih banyak setiap kali memancing."
  },
  royalcrest: {
    name: "Royal Crest",
    rarity: "legendary",
    effect: { luck: 2.0, sellMultiplier: 2.5 },
    desc: "Simbol para raja laut, meningkatkan nilai dan keberuntungan luar biasa."
  },
  crystalwave: {
    name: "Crystal Wave",
    rarity: "legendary",
    effect: { luck: 1.85, progressSpeed: 1.4, mutationChance: 0.04 },
    desc: "Gelombang kristal memberikan hasil langka dan kecepatan tinggi."
  },
  storming: {
    name: "Storming",
    rarity: "legendary",
    effect: { luck: 1.95, lureSpeed: 1.45, mutationChance: 0.02 },
    desc: "+95% Luck, +45% Lure Speed, +2% Mutation chance"
  },
  seaoverlord: {
    name: "Sea Overlord",
    rarity: "legendary",
    effect: { fishSize: 6, sellMultiplier: 4 },
    desc: "+300% Fish Size, 4× Sell Value"
  },
  infernal: {
    name: "Infernal",
    rarity: "legendary",
    effect: { luck: 1.6, sellMultiplier: 2 },
    desc: "Terbakar oleh api laut dalam, meningkatkan keberuntungan dan nilai jual."
  },
  leviathan: {
    name: "Leviathan",
    rarity: "legendary",
    effect: { fishSize: 3, luck: 1.4 },
    desc: "Diberkahi kekuatan monster laut — ikan yang lebih besar dan lebih berharga."
  },
  tempest: {
    name: "Tempest",
    rarity: "legendary",
    effect: { lureSpeed: 1.5, progressSpeed: 1.3 },
    desc: "Kekuatan badai mempercepat segala hal di lautan."
  },
  phantom: {
    name: "Phantom",
    rarity: "legendary",
    effect: { luck: 1.8, mutationChance: 0.05 },
    desc: "Energi roh laut menambah keberuntungan dan peluang mutasi langka."
  },
  chaotic: {
    name: "Chaotic",
    rarity: "mythic",
    effect: { sellMultiplier: 24 },
    desc: "Meningkatkan nilai jual ikan secara drastis."
  },
  wise: {
    name: "Wise",
    rarity: "mythic",
    effect: { xpMultiplier: 5 },
    desc: "×5 XP dari semua hasil tangkapan"
  },
  mutated: {
    name: "Mutated",
    rarity: "mythic",
    effect: { mutationChance: 0.1 },
    desc: "+10% Mutation chance"
  },
  immortal: {
    name: "Immortal",
    rarity: "mythic",
    effect: { luck: 1.75, progressSpeed: 1.3, sellMultiplier: 16 },
    desc: "+75% Luck, +30% Progress Speed, 16× Sell Value"
  },
  abyssborn: {
    name: "Abyssborn",
    rarity: "mythic",
    effect: { luck: 2.2, mutationChance: 0.12, sellMultiplier: 4 },
    desc: "Kekuatan laut dalam menganugerahkan hasil tangkapan yang sangat berharga."
  },
  astral: {
    name: "Astral",
    rarity: "mythic",
    effect: { luck: 2.5, progressSpeed: 1.4 },
    desc: "Daya kosmik dari bintang-bintang memandu setiap lemparan."
  },
  tyrant: {
    name: "Tyrant",
    rarity: "mythic",
    effect: { fishSize: 4, sellMultiplier: 5 },
    desc: "Rod penguasa samudra — hanya untuk pemancing sejati."
  },
  demonic: {
    name: "Demonic",
    rarity: "mythic",
    effect: { luck: 3.0, mutationChance: 0.2 },
    desc: "Dipenuhi kekuatan jahat laut, meningkatkan keberuntungan ekstrem dan mutasi."
  },
  eternity: {
    name: "Eternity",
    rarity: "mythic",
    effect: { luck: 2.8, progressSpeed: 1.6, sellMultiplier: 6 },
    desc: "Energi abadi dari samudra memberi peningkatan luar biasa pada semua aspek."
  },
   voidtide: {
    name: "Void Tide",
    rarity: "mythic",
    effect: { luck: 3.2, mutationChance: 0.18, sellMultiplier: 5 },
    desc: "Pasang surut dari kekosongan laut memutarbalikkan keberuntunganmu."
  },
  celestia: {
    name: "Celestia",
    rarity: "mythic",
    effect: { luck: 2.8, xpMultiplier: 3.5, progressSpeed: 1.5 },
    desc: "Kekuatan bintang memberi kebijaksanaan dan hasil langka dari setiap lemparan."
  },
  abyssalflare: {
    name: "Abyssal Flare",
    rarity: "godly",
    effect: { luck: 4.5, mutationChance: 0.25, sellMultiplier: 9 },
    desc: "Api dari jurang laut menyalakan setiap tangkapan dengan nilai tinggi."
  },
  reapersnet: {
    name: "Reaper's Net",
    rarity: "godly",
    effect: { luck: 4.0, progressSpeed: 2.0, sellMultiplier: 7 },
    desc: "Jaring sang pencabut laut, memastikan tidak ada ikan berharga yang lolos."
  },
  radiantcore: {
    name: "Radiant Core",
    rarity: "godly",
    effect: { luck: 4.0, sellMultiplier: 8 },
    desc: "Energi terang dari inti laut meningkatkan nilai jual ikan dan keberuntungan besar."
  },
  leviathansgrasp: {
    name: "Leviathan's Grasp",
    rarity: "godly",
    effect: { fishSize: 5, mutationChance: 0.15 },
    desc: "Cengkeraman raksasa laut — setiap tangkapan berpotensi menjadi kolosal dan langka."
  },
  chaosreign: {
    name: "Chaos Reign",
    rarity: "godly",
    effect: { luck: 4.2, sellMultiplier: 10, mutationChance: 0.2 },
    desc: "Kekacauan laut purba memberikan kekuatan tanpa batas pada hasil tangkapanmu."
  },
  timeless: {
    name: "Timeless",
    rarity: "secret",
    effect: { luck: 5.0, progressSpeed: 2.0, xpMultiplier: 3 },
    desc: "Energi waktu sendiri membimbingmu — setiap hasil tangkapan lebih cepat, lebih berharga, dan lebih berpengalaman."
  },
  voidheart: {
    name: "Voidheart",
    rarity: "secret",
    effect: { luck: 6.0, mutationChance: 0.25, sellMultiplier: 12 },
    desc: "Inti kekosongan laut dalam memberikan kekuatan mutasi dan nilai jual ekstrem."
  },
  abysscore: {
    name: "Abyss Core",
    rarity: "secret",
    effect: { luck: 5.0, mutationChance: 0.3, sellMultiplier: 15 },
    desc: "Energi terdalam samudra mengubah setiap hasil menjadi keajaiban langka."
  },
  godslayer: {
    name: "Godslayer",
    rarity: "secret",
    effect: { luck: 7.5, progressSpeed: 2.5, sellMultiplier: 20, mutationChance: 0.35 },
    desc: "Rod legendaris yang menantang dewa laut — kekuatan mutlak untuk para master pemancing."
  },
  omnicore: {
    name: "Omnicore",
    rarity: "secret",
    effect: { luck: 6.5, progressSpeed: 2.2, xpMultiplier: 4 },
    desc: "Inti kekuatan laut universal — setiap aspek memancingmu ditingkatkan drastis."
  },
  paradox: {
    name: "Paradox",
    rarity: "secret",
    effect: { luck: 7.0, mutationChance: 0.4, sellMultiplier: 18 },
    desc: "Rod yang melampaui logika waktu dan ruang, memberikan hasil yang mustahil."
  },
  universe: {
    name: "Universe",
    rarity: "secret",
    effect: { luck: 8.5, mutationChance: 0.45, sellMultiplier: 24 },
    desc: "Rod yang mudah mendapatkan ikan semua secret"
  },
  // ── NEW ENCHANTS ────────────────────────────────
  focused: {
    name: "Focused",
    rarity: "common",
    effect: { progressSpeed: 1.15, xpMultiplier: 1.1 },
    desc: "+15% Progress Speed, +10% XP"
  },
  nimble: {
    name: "Nimble",
    rarity: "common",
    effect: { lureSpeed: 1.25, progressSpeed: 1.1 },
    desc: "+25% Lure Speed, +10% Progress Speed"
  },
  sturdy: {
    name: "Sturdy",
    rarity: "rare",
    effect: { sellMultiplier: 1.4, luck: 1.1 },
    desc: "+40% Sell Value, +10% Luck"
  },
  radiant: {
    name: "Radiant",
    rarity: "rare",
    effect: { luck: 1.5, mutationChance: 0.01 },
    desc: "+50% Luck, +1% Mutation Chance"
  },
  primal: {
    name: "Primal",
    rarity: "epic",
    effect: { luck: 1.8, fishSize: 1.5, sellMultiplier: 1.3 },
    desc: "+80% Luck, +50% Fish Size, +30% Sell"
  },
  venom: {
    name: "Venom",
    rarity: "epic",
    effect: { mutationChance: 0.05, sellMultiplier: 1.8 },
    desc: "+5% Mutation Chance, +80% Sell Value"
  },
  cursed: {
    name: "Cursed",
    rarity: "legendary",
    effect: { luck: 2.2, mutationChance: 0.06, sellMultiplier: 2.2 },
    desc: "+120% Luck, +6% Mutation, +120% Sell — berisiko tinggi, hasil tinggi"
  },
  dragonscale: {
    name: "Dragonscale",
    rarity: "legendary",
    effect: { fishSize: 4, luck: 1.7, progressSpeed: 1.3 },
    desc: "+300% Fish Size, +70% Luck, +30% Progress"
  },
  nebula: {
    name: "Nebula",
    rarity: "mythic",
    effect: { luck: 3.5, xpMultiplier: 4, mutationChance: 0.15 },
    desc: "+250% Luck, 4x XP, +15% Mutation"
  },
  singularity: {
    name: "Singularity",
    rarity: "mythic",
    effect: { sellMultiplier: 30, progressSpeed: 1.5 },
    desc: "30× Sell Value, +50% Progress Speed"
  },
  omega: {
    name: "Omega",
    rarity: "godly",
    effect: { luck: 5.5, sellMultiplier: 12, mutationChance: 0.28, fishSize: 3 },
    desc: "+450% Luck, 12× Sell, +28% Mutation, +200% Size"
  },
  genesis: {
    name: "Genesis",
    rarity: "godly",
    effect: { luck: 5.0, xpMultiplier: 5, progressSpeed: 2.2, sellMultiplier: 8 },
    desc: "Permulaan dari kekuatan tertinggi — semua aspek meningkat drastis"
  },
  apocalypse: {
    name: "Apocalypse",
    rarity: "secret",
    effect: { luck: 9.0, sellMultiplier: 28, mutationChance: 0.5, fishSize: 4 },
    desc: "Kekuatan akhir zaman — tangkapan luar biasa dari kedalaman tergelap"
  },
  etherbound: {
    name: "Etherbound",
    rarity: "secret",
    effect: { luck: 7.5, xpMultiplier: 6, progressSpeed: 2.5, mutationChance: 0.4 },
    desc: "Terikat kekuatan ether — XP dan luck tertinggi yang pernah ada"
  },
};

// ===== GAME CONSTANTS =====

const SEASON_CONFIG = {
    name: "Season 1 — Age of Tides",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2099-12-31"), // Admin set via .setseason
    prizeRod: "omegaRod",
    prizeTokens: 500,
    prizeMoney: 10000000000000,
    topN: 3,
    pointsPerFish: 1,
    pointsPerRareFish: { rare: 5, epic: 15, legendary: 40, mythic: 100, godly: 300, secret: 800, extinct: 2000, special: 5000 },
    pointsPerMutation: 20,
};

// ══════════════════════════════════════════════════════════
//   PRESTIGE SYSTEM
// ══════════════════════════════════════════════════════════
const PRESTIGE_REQUIREMENTS = [
    { level: 1, fish: 500,  money: 10000000000,    reward: "Prestige Rod + 50 tokens + Title 'Veteran'" },
    { level: 2, fish: 1500, money: 1000000000000,  reward: "Luck +20% permanent + 150 tokens" },
    { level: 3, fish: 4000, money: 100000000000000, reward: "Cosmic Rod + 500 tokens + Title 'Legend'" },
    { level: 4, fish: 10000, money: 1e19,           reward: "Double EXP permanent + 1000 tokens" },
    { level: 5, fish: 25000, money: 1e22,           reward: "Eternity Rod + 5000 tokens + Title 'God'" },
];

const PRESTIGE_TITLES = {
    0: "Pemancing Baru",
    1: "Veteran",
    2: "Master Angler",
    3: "Legend",
    4: "Transcendent",
    5: "God of Fishing",
};

// ══════════════════════════════════════════════════════════
//   UPGRADE SHOP (sink uang)
// ══════════════════════════════════════════════════════════
const UPGRADES = {
    luck: {
        name: "🍀 Luck Upgrade",
        desc: "Tingkatkan luck permanen +2% per level",
        maxLevel: 50,
        baseCost: 5000000,
        costMultiplier: 2.5,
        effect: (lv) => lv * 0.02,
        getCost: (lv) => Math.floor(5000000 * Math.pow(2.5, lv)),
    },
    speed: {
        name: "⚡ Speed Upgrade",
        desc: "Kurangi waktu mancing -1% per level",
        maxLevel: 40,
        baseCost: 3000000,
        costMultiplier: 2.3,
        effect: (lv) => lv * 0.01,
        getCost: (lv) => Math.floor(3000000 * Math.pow(2.3, lv)),
    },
    sell: {
        name: "💰 Sell Upgrade",
        desc: "Nilai jual ikan +5% per level",
        maxLevel: 60,
        baseCost: 8000000,
        costMultiplier: 2.8,
        effect: (lv) => lv * 0.05,
        getCost: (lv) => Math.floor(8000000 * Math.pow(2.8, lv)),
    },
};

// ══════════════════════════════════════════════════════════
//   DAILY REWARD
// ══════════════════════════════════════════════════════════
const DAILY_REWARDS = [
    { streak: 1,  money: 50000,       tickets: 0, desc: "Hari 1 🎣" },
    { streak: 2,  money: 100000,      tickets: 0, desc: "Hari 2 ✨" },
    { streak: 3,  money: 250000,      tickets: 1, desc: "Hari 3 🎟️ +1 tiket gacha!" },
    { streak: 4,  money: 500000,      tickets: 0, desc: "Hari 4 💰" },
    { streak: 5,  money: 1000000,     tickets: 2, desc: "Hari 5 🎟️🎟️ +2 tiket gacha!" },
    { streak: 6,  money: 2000000,     tickets: 0, desc: "Hari 6 🌟" },
    { streak: 7,  money: 10000000,    tickets: 5, desc: "Hari 7 🔥 BONUS BESAR! +5 tiket!" },
    { streak: 14, money: 100000000,   tickets: 10, desc: "2 Minggu 💎 STREAK BONUS!" },
    { streak: 30, money: 1000000000,  tickets: 20, desc: "1 Bulan 👑 LEGEND STREAK!" },
];

// ══════════════════════════════════════════════════════════
//   GACHA SYSTEM
// ══════════════════════════════════════════════════════════
const GACHA_COST_COINS   = 5000000;   // 5M per pull pakai coins
const GACHA_COST_TICKETS = 1;         // 1 tiket per pull
const GACHA_PITY_LIMIT   = 80;        // pity setelah 80 pull tanpa SSR

const GACHA_POOL = [
    // ─── COMMON (55%) — campuran coins + enchant scroll + item kecil ────
    { type: "enchant_scroll", value: "common",  label: "📜 Enchant Scroll (Common)",  rarity: "common", weight: 22 },
    { type: "tickets",        value: 2,         label: "🎟️ 2 Tiket Gacha",            rarity: "common", weight: 18 },
    { type: "xp_boost",       value: 1.5,       label: "⚡ XP Boost ×1.5 (1 sesi)",   rarity: "common", weight: 15 },

    // ─── RARE (25%) — rod starter + enchant rare + bait buff ─────────────
    { type: "rod",            value: "luckyrod",    label: "🎣 Lucky Rod",            rarity: "rare", weight: 10 },
    { type: "enchant_scroll", value: "rare",        label: "📜 Enchant Scroll (Rare)", rarity: "rare", weight: 8 },
    { type: "tickets",        value: 5,             label: "🎟️ 5 Tiket Gacha",        rarity: "rare", weight: 4 },
    { type: "bait",           value: "goldbait",    label: "🪱 Golden Bait (×2 luck)", rarity: "rare", weight: 3 },

    // ─── EPIC (13%) — rod menengah + enchant epic + token kecil ──────────
    { type: "rod",            value: "precisionrod", label: "🎣 Precision Rod",        rarity: "epic", weight: 5 },
    { type: "enchant_scroll", value: "epic",         label: "📜 Enchant Scroll (Epic)", rarity: "epic", weight: 4 },
    { type: "tokens",         value: 25,             label: "🪙 25 Prestige Tokens",   rarity: "epic", weight: 3 },
    { type: "bait",           value: "crystalbait",  label: "💎 Crystal Bait (×3 luck+sell)", rarity: "epic", weight: 1 },

    // ─── LEGENDARY (6%) — rod mahal + token besar ────────────────────────
    { type: "rod",    value: "midasrod",   label: "🎣 Midas Rod",            rarity: "legendary", weight: 2.5 },
    { type: "tokens", value: 75,           label: "🪙 75 Prestige Tokens",   rarity: "legendary", weight: 2.0 },
    { type: "rod",    value: "avalancherod", label: "🎣 Avalanche Rod",      rarity: "legendary", weight: 1.5 },

    // ─── SSR (1% / pity guaranteed) — rod ultra ─────────────────────────
    { type: "rod",    value: "voidrod",    label: "🌑 Void Rod",             rarity: "ssr", weight: 0.5 },
    { type: "rod",    value: "cosmicrod",  label: "🌌 Cosmic Rod",           rarity: "ssr", weight: 0.3 },
    { type: "tokens", value: 200,          label: "🪙 200 Prestige Tokens",  rarity: "ssr", weight: 0.2 },
];

// ── Enchant scroll effect — diapply saat .view / setelah mancing ──────────
// type "enchant_scroll": user dapat enchant random sesuai rarity scroll
// type "xp_boost": diterapkan ke rod XP gain next mancing (simpan ke user.activeBoosts)
// type "bait": buff luck & sell untuk 1x mancing berikutnya

// ══════════════════════════════════════════════════════════
//   EVENT SYSTEM
// ══════════════════════════════════════════════════════════
let ACTIVE_EVENT = {
    active: false,
    name: "",
    desc: "",
    multiplier: 1,
    bonusMutation: 0,
    endTime: null,
};

// ══════════════════════════════════════════════════════════
//   PRESTIGE TOKEN SHOP
// ══════════════════════════════════════════════════════════
const TOKEN_SHOP = [
    { id: "tokenshop_voidrod",    name: "🌑 Void Rod",      cost: 300, type: "rod",    value: "voidrod"    },
    { id: "tokenshop_cosmicrod",  name: "🌌 Cosmic Rod",    cost: 800, type: "rod",    value: "cosmicrod"  },
    { id: "tokenshop_tickets10",  name: "🎟️ 10 Tiket Gacha", cost: 50,  type: "tickets", value: 10         },
    { id: "tokenshop_tickets50",  name: "🎟️ 50 Tiket Gacha", cost: 200, type: "tickets", value: 50         },
    { id: "tokenshop_money",      name: "💰 100B Coins",    cost: 100, type: "coins",  value: 100000000000 },
    { id: "tokenshop_bigmoney",   name: "💰 10T Coins",     cost: 500, type: "coins",  value: 10000000000000 },
];

// ══════════════════════════════════════════════════════════
//   HELPER FUNCTIONS BARU
// ══════════════════════════════════════════════════════════
function formatMoney(number) {
    if (number === null || number === undefined || isNaN(number)) return "0";
    const n = Number(number);
    if (n === 0) return "0";
    const suffixes = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qd', 'Qid', 'Sxd', 'Spd', 'Od', 'Nd', 'Vg'];
    let tier = Math.floor(Math.log10(Math.abs(n)) / 3);
    if (tier >= suffixes.length) tier = suffixes.length - 1;
    if (tier < 0) return n.toFixed(2);
    const scale = Math.pow(10, tier * 3);
    return (Math.round(n / scale * 100) / 100) + suffixes[tier];
}

function parseAmount(text) {
    const units = { K:1e3, M:1e6, B:1e9, T:1e12, QA:1e15, QI:1e18, SX:1e21, SP:1e24, OC:1e27, NO:1e30 };
    const m = String(text).toUpperCase().match(/^([\d.,]+)([A-Z]*)$/);
    if (!m) return NaN;
    let num = parseFloat(m[1].replace(/,/g, ''));
    if (units[m[2]]) num *= units[m[2]];
    return Math.floor(num);
}

function doGachaPull(user) {
    const isPity = (user.gachaPity || 0) >= GACHA_PITY_LIMIT;
    const pool = isPity
        ? GACHA_POOL.filter(x => x.rarity === 'ssr')
        : GACHA_POOL;
    const totalW = pool.reduce((a, b) => a + b.weight, 0);
    let roll = Math.random() * totalW, acc = 0;
    let item = pool[0];
    for (const p of pool) { acc += p.weight; if (roll <= acc) { item = p; break; } }
    const isSSR = item.rarity === 'ssr';
    user.gachaPity = isSSR ? 0 : (user.gachaPity || 0) + 1;
    return { item, isSSR, pity: isPity };
}

function addSeasonPoints(user, fish) {
    const extras = SEASON_CONFIG.pointsPerRareFish;
    const pts = extras[fish.rarity] || SEASON_CONFIG.pointsPerFish;
    user.seasonPoints = (user.seasonPoints || 0) + pts;
    if (fish.mutations && fish.mutations.some(m => m !== 'Normal')) {
        user.seasonPoints += SEASON_CONFIG.pointsPerMutation;
    }
    return pts;
}

function getUpgradedStats(user, rod) {
    const luckBonus  = UPGRADES.luck.effect(user.luckUpgrade || 0);
    const speedBonus = UPGRADES.speed.effect(user.speedUpgrade || 0);
    const sellBonus  = UPGRADES.sell.effect(user.sellUpgrade || 0);
    const prestigeBonus = (user.prestige || 0) * 0.05;

    // Cek bait aktif di inventory
    const bait = (user.inventory || []).find(i => i.type === 'bait');
    const baitLuck = bait?.id === 'goldbait' ? 0.3 : bait?.id === 'crystalbait' ? 0.6 : 0;
    const baitSell = bait?.id === 'crystalbait' ? 0.5 : 0;

    return {
        luck: (rod.luck || 0) + luckBonus + prestigeBonus + baitLuck,
        speed: Math.min((rod.speed || 0) + speedBonus, 0.98),
        sellMultiplier: (rod.sellMultiplier || 0) + sellBonus + baitSell,
        activeBait: bait || null,
    };
}


// ╔══════════════════════════════════════════════════════════════╗
// ║              FISCH BOT v2 — ENHANCED SYSTEMS                ║
// ╚══════════════════════════════════════════════════════════════╝

// ══════════════════════════════════════════════════════════════
//   WEATHER SYSTEM — mempengaruhi jenis ikan, luck, speed
// ══════════════════════════════════════════════════════════════
const WEATHERS = {
    sunny: {
        name: "☀️ Cerah",
        desc: "Cuaca cerah, ikan aktif di permukaan.",
        luckMult: 1.0,
        speedMult: 1.0,
        rarityBoost: {},
        exclusive: [],
        color: "yellow",
    },
    cloudy: {
        name: "☁️ Mendung",
        desc: "Langit mendung, ikan mulai turun ke dalam.",
        luckMult: 1.05,
        speedMult: 0.95,
        rarityBoost: { rare: 1.1, epic: 1.05 },
        exclusive: [],
    },
    rainy: {
        name: "🌧️ Hujan",
        desc: "Hujan membuat ikan lapar! Luck meningkat signifikan.",
        luckMult: 1.20,
        speedMult: 0.85,
        rarityBoost: { rare: 1.2, epic: 1.15, legendary: 1.1 },
        exclusive: ["Rainfish", "Stormcaller Eel"],
    },
    stormy: {
        name: "⛈️ Badai",
        desc: "Badai! Ikan langka bermunculan dari kedalaman.",
        luckMult: 1.45,
        speedMult: 0.70,
        rarityBoost: { legendary: 1.3, mythic: 1.2, godly: 1.1 },
        exclusive: ["Thunder Serpent Jr", "Storm Marlin"],
        penalty: "Waktu mancing +40%",
    },
    foggy: {
        name: "🌫️ Berkabut",
        desc: "Kabut tebal — mutasi lebih sering muncul!",
        luckMult: 0.95,
        speedMult: 1.0,
        mutationBonus: 0.05,
        rarityBoost: { mythic: 1.05 },
        exclusive: ["Shadow Carp", "Phantom Eel"],
    },
    windy: {
        name: "💨 Berangin",
        desc: "Angin kencang mengocok perairan, speed naik!",
        luckMult: 0.90,
        speedMult: 1.30,
        rarityBoost: {},
        exclusive: [],
    },
    blizzard: {
        name: "❄️ Blizzard",
        desc: "Badai salju — hanya ikan kutub yang muncul!",
        luckMult: 1.35,
        speedMult: 0.60,
        rarityBoost: { godly: 1.25, secret: 1.15 },
        exclusive: ["Arctic Leviathan", "Glacial Titan"],
        penalty: "Hanya mancing di pulau tertentu",
    },
    moonlight: {
        name: "🌙 Cahaya Bulan",
        desc: "Malam bulan purnama — ikan misterius muncul!",
        luckMult: 1.15,
        speedMult: 1.05,
        rarityBoost: { secret: 1.3, mythic: 1.1 },
        exclusive: ["Moonscale Koi", "Lunar Leviathan"],
        mutationBonus: 0.03,
    },
};

// Cuaca global (berubah tiap 2 jam)
let CURRENT_WEATHER = {
    key: 'sunny',
    ...WEATHERS.sunny,
    expiresAt: Date.now() + 2 * 3600_000,
};

function rotateWeather() {
    const keys = Object.keys(WEATHERS);
    // Weight-based random (badai lebih jarang)
    const weights = { sunny:30, cloudy:25, rainy:20, stormy:5, foggy:10, windy:15, blizzard:3, moonlight:8 };
    const totalW = Object.values(weights).reduce((a,b)=>a+b,0);
    let roll = Math.random() * totalW, acc = 0;
    let chosen = 'sunny';
    for (const [k,w] of Object.entries(weights)) { acc+=w; if(roll<=acc){chosen=k;break;} }
    CURRENT_WEATHER = { key: chosen, ...WEATHERS[chosen], expiresAt: Date.now() + 2*3600_000 };
    console.log(`[WEATHER] 🌦️ Cuaca berganti: ${WEATHERS[chosen].name}`);
}

// Cek dan rotate cuaca tiap menit
setInterval(() => {
    if (Date.now() >= CURRENT_WEATHER.expiresAt) rotateWeather();
}, 60_000);

// ══════════════════════════════════════════════════════════════
//   ACHIEVEMENT SYSTEM
// ══════════════════════════════════════════════════════════════
const ACHIEVEMENTS = {
    // ── FISHING ──
    first_fish:     { id:'first_fish',    name:'🎣 Pemancing Pemula',      desc:'Tangkap ikan pertamamu',                    pts:5,   reward:{money:1000} },
    fish_10:        { id:'fish_10',       name:'🐟 Nelayan Lokal',         desc:'Tangkap 10 ikan',                           pts:10,  reward:{money:5000} },
    fish_50:        { id:'fish_50',       name:'🐠 Nelayan Berpengalaman', desc:'Tangkap 50 ikan',                           pts:20,  reward:{money:25000} },
    fish_100:       { id:'fish_100',      name:'🦈 Nelayan Handal',        desc:'Tangkap 100 ikan',                          pts:35,  reward:{money:100000} },
    fish_500:       { id:'fish_500',      name:'🌊 Master Pancing',        desc:'Tangkap 500 ikan',                          pts:75,  reward:{money:1000000, tickets:5} },
    fish_1000:      { id:'fish_1000',     name:'👑 Legenda Laut',          desc:'Tangkap 1000 ikan',                         pts:150, reward:{money:10000000, tokens:20} },
    fish_5000:      { id:'fish_5000',     name:'🌌 Dewa Pancing',          desc:'Tangkap 5000 ikan',                         pts:500, reward:{money:1000000000, tokens:100} },
    // ── RARITY ──
    first_rare:     { id:'first_rare',    name:'💚 Pertama Rare',          desc:'Tangkap ikan rare pertama',                 pts:15,  reward:{money:5000} },
    first_epic:     { id:'first_epic',    name:'💙 Pertama Epic',          desc:'Tangkap ikan epic pertama',                 pts:25,  reward:{money:20000} },
    first_legendary:{ id:'first_legendary',name:'💛 Pertama Legendary',   desc:'Tangkap ikan legendary pertama',            pts:50,  reward:{money:100000} },
    first_mythic:   { id:'first_mythic',  name:'🟣 Pertama Mythic',       desc:'Tangkap ikan mythic pertama',               pts:100, reward:{money:500000, tickets:2} },
    first_godly:    { id:'first_godly',   name:'🌟 Pertama Godly',        desc:'Tangkap ikan godly pertama',                pts:200, reward:{money:5000000, tickets:5} },
    first_secret:   { id:'first_secret',  name:'⚫ Pertama Secret',       desc:'Tangkap ikan secret pertama',               pts:400, reward:{money:50000000, tokens:15} },
    first_extinct:  { id:'first_extinct', name:'🦕 Pertama Extinct',      desc:'Tangkap ikan yang sudah punah!',            pts:800, reward:{money:500000000, tokens:50} },
    // ── MUTATION ──
    first_mutation: { id:'first_mutation',name:'🧬 Mutasi Pertama',       desc:'Temukan mutasi pertama',                    pts:20,  reward:{money:10000} },
    rare_fish_10:   { id:'rare_fish_10',  name:'💎 Kolektor Langka',      desc:'Tangkap 10 ikan rare+',                     pts:40,  reward:{money:50000} },
    mutation_10:    { id:'mutation_10',   name:'🔬 Ilmuwan Laut',         desc:'Temukan 10 mutasi berbeda',                  pts:80,  reward:{money:200000, tickets:3} },
    // ── WEALTH ──
    money_1m:       { id:'money_1m',      name:'💰 Jutawan',              desc:'Kumpulkan 1 juta uang',                     pts:20,  reward:{tickets:1} },
    money_1b:       { id:'money_1b',      name:'💎 Miliarder',            desc:'Kumpulkan 1 miliar uang',                   pts:75,  reward:{tickets:3} },
    money_1t:       { id:'money_1t',      name:'🏦 Triliuner',            desc:'Kumpulkan 1 triliun uang',                  pts:200, reward:{tokens:10} },
    sell_100m:      { id:'sell_100m',     name:'🤑 Penjual Ulung',        desc:'Total penjualan mencapai 100 juta',         pts:50,  reward:{money:5000000} },
    // ── ROD ──
    rod_level5:     { id:'rod_level5',    name:'🎣 Upgrade Pertama',      desc:'Upgrade rod ke level 5',                    pts:15,  reward:{money:10000} },
    rod_level20:    { id:'rod_level20',   name:'⚡ Rod Master',           desc:'Upgrade rod ke level 20',                   pts:60,  reward:{money:100000} },
    enchant_first:  { id:'enchant_first', name:'✨ Pertama Enchant',      desc:'Pasang enchant pertama kali',               pts:20,  reward:{money:20000} },
    own_3rods:      { id:'own_3rods',     name:'🎣 Kolektor Rod',         desc:'Miliki 3 rod berbeda',                      pts:30,  reward:{money:50000} },
    own_7rods:      { id:'own_7rods',     name:'🗄️ Gudang Rod',          desc:'Miliki 7 rod berbeda',                      pts:100, reward:{tickets:5} },
    // ── EXPLORATION ──
    visit_3islands: { id:'visit_3islands',name:'🏝️ Penjelajah',          desc:'Kunjungi 3 pulau berbeda',                  pts:25,  reward:{money:30000} },
    visit_all:      { id:'visit_all',     name:'🌍 Keliling Dunia',       desc:'Kunjungi semua pulau',                      pts:150, reward:{money:500000, tokens:5} },
    // ── SPECIAL ──
    big_fish:       { id:'big_fish',      name:'🐳 Raksasa Laut',         desc:'Tangkap ikan dengan berat > 1000 kg',       pts:100, reward:{money:1000000} },
    perfect_10:     { id:'perfect_10',    name:'💯 Sempurna',             desc:'Lakukan 10 mancing tanpa hasil common',     pts:75,  reward:{money:500000} },
    storm_fisher:   { id:'storm_fisher',  name:'⛈️ Petir di Badai',      desc:'Mancing saat cuaca badai dan dapat mythic+',pts:200, reward:{money:5000000, tokens:10} },
    night_catcher:  { id:'night_catcher', name:'🌙 Pemburu Malam',        desc:'Mancing saat Moonlight 5 kali',             pts:80,  reward:{money:500000, tickets:2} },
};

async function checkAchievements(user, context = {}) {
    const newAch = [];
    const earned = new Set(user.achievements || []);

    const grant = (id) => {
        if (!earned.has(id) && ACHIEVEMENTS[id]) {
            earned.add(id);
            newAch.push(ACHIEVEMENTS[id]);
        }
    };

    const fish = user.fishCaught || 0;
    const rare = user.rareFishCaught || 0;
    const inv = user.inventory || [];
    const rods = user.fishingRods;
    const rodCount = rods instanceof Map ? rods.size : Object.keys(rods||{}).length;
    const islands_visited = [...new Set((user.travelFound||[]).concat([user.currentIsland||'mousewood']))];

    // Fishing count
    if (fish >= 1)    grant('first_fish');
    if (fish >= 10)   grant('fish_10');
    if (fish >= 50)   grant('fish_50');
    if (fish >= 100)  grant('fish_100');
    if (fish >= 500)  grant('fish_500');
    if (fish >= 1000) grant('fish_1000');
    if (fish >= 5000) grant('fish_5000');

    // Rarity
    if (context.fish) {
        const r = context.fish.rarity;
        if (r === 'rare' || r === 'epic' || r === 'legendary' || r === 'mythic' || r === 'godly' || r === 'secret' || r === 'extinct') grant('first_rare');
        if (r === 'epic' || r === 'legendary' || r === 'mythic' || r === 'godly' || r === 'secret' || r === 'extinct') grant('first_epic');
        if (r === 'legendary' || r === 'mythic' || r === 'godly' || r === 'secret' || r === 'extinct') grant('first_legendary');
        if (r === 'mythic' || r === 'godly' || r === 'secret' || r === 'extinct') grant('first_mythic');
        if (r === 'godly' || r === 'secret' || r === 'extinct') grant('first_godly');
        if (r === 'secret' || r === 'extinct') grant('first_secret');
        if (r === 'extinct') grant('first_extinct');
        if (context.fish.kg > 1000) grant('big_fish');
        if (context.fish.isMutated) grant('first_mutation');
        // Storm fisher
        if (CURRENT_WEATHER.key === 'stormy' && ['mythic','godly','secret','extinct'].includes(r)) grant('storm_fisher');
    }

    // Rare fish count
    if (rare >= 10)   grant('rare_fish_10');

    // Wealth
    const totalEarned = user.totalEarned || 0;
    if ((user.money||0) >= 1e6)    grant('money_1m');
    if ((user.money||0) >= 1e9)    grant('money_1b');
    if ((user.money||0) >= 1e12)   grant('money_1t');
    if (totalEarned >= 1e8)        grant('sell_100m');

    // Rod
    const maxRodLevel = rods instanceof Map
        ? Math.max(...[...rods.values()].map(r=>r.level||1))
        : Math.max(...Object.values(rods||{basicrod:{level:1}}).map(r=>r.level||1));
    if (maxRodLevel >= 5)  grant('rod_level5');
    if (maxRodLevel >= 20) grant('rod_level20');
    if (rodCount >= 3) grant('own_3rods');
    if (rodCount >= 7) grant('own_7rods');
    if (context.enchanted) grant('enchant_first');

    // Exploration
    if (islands_visited.length >= 3) grant('visit_3islands');
    const allIslandKeys = ['mousewood','roslitbay','mushgroveswamp','terrapinisland','theocean','atlantis','volcaniddepths','crystalcaves'];
    if (allIslandKeys.every(k => islands_visited.includes(k))) grant('visit_all');

    // Mutation count
    const mutCount = (user.mutationFound||[]).length;
    if (mutCount >= 10) grant('mutation_10');

    // Night catcher — perlu counter di context
    if (context.moonlight) {
        const mc = (user.achievementPoints || 0);
        // simplified — grant kalau sudah cukup moonlight catcher
    }

    if (newAch.length > 0) {
        user.achievements = [...earned];
        let bonusMoney = 0, bonusTickets = 0, bonusTokens = 0;
        for (const ach of newAch) {
            user.achievementPoints = (user.achievementPoints||0) + ach.pts;
            bonusMoney   += ach.reward?.money   || 0;
            bonusTickets += ach.reward?.tickets || 0;
            bonusTokens  += ach.reward?.tokens  || 0;
        }
        user.money         = (user.money||0)         + bonusMoney;
        user.gachaTickets  = (user.gachaTickets||0)  + bonusTickets;
        user.prestigeTokens= (user.prestigeTokens||0)+ bonusTokens;
    }
    return newAch;
}

// ══════════════════════════════════════════════════════════════
//   FISH CONDITION SYSTEM — ikan dalam kondisi tertentu punya nilai + desc khusus
// ══════════════════════════════════════════════════════════════
const FISH_CONDITIONS = [
    { id: 'perfect',    label: '✨ Perfect',    chance: 0.05, priceBonus: 2.5,   desc: 'Tangkapan sempurna!' },
    { id: 'fresh',      label: '🌊 Segar',      chance: 0.15, priceBonus: 1.5,   desc: 'Ikan masih sangat segar.' },
    { id: 'giant',      label: '🔴 Raksasa',    chance: 0.04, priceBonus: 3.0,   desc: 'Ikan ukuran raksasa langka!' },
    { id: 'diseased',   label: '🦠 Sakit',      chance: 0.08, priceBonus: 0.4,   desc: 'Ikan kurang sehat, nilainya turun.' },
    { id: 'old',        label: '📜 Tua',        chance: 0.06, priceBonus: 1.8,   desc: 'Ikan tua sangat berharga bagi kolektor.' },
    { id: 'shiny',      label: '✨ Bersinar',   chance: 0.03, priceBonus: 4.0,   desc: 'Kilap luar biasa! Langka sekali!' },
    { id: 'normal',     label: '',              chance: 0.59, priceBonus: 1.0,   desc: '' },
];

function rollFishCondition() {
    let roll = Math.random(), acc = 0;
    for (const c of FISH_CONDITIONS) {
        acc += c.chance;
        if (roll <= acc) return c;
    }
    return FISH_CONDITIONS.find(c=>c.id==='normal');
}

// ══════════════════════════════════════════════════════════════
//   ISLAND COOLDOWN — tiap pulau punya cooldown tersendiri
//   Pemain bisa mancing kapan saja, tapi ikan di pulau mahal ada cooldown
// ══════════════════════════════════════════════════════════════
const ISLAND_COOLDOWNS = {
    mousewood:       0,          // tidak ada cooldown (pulau awal)
    roslitbay:       0,
    mushgroveswamp:  0,
    terrapinisland:  30,         // 30 detik cooldown antar sesi
    theocean:        45,
    atlantis:        90,
    volcaniddepths:  120,
    crystalcaves:    180,
};

// ══════════════════════════════════════════════════════════════
//   ROD SKIN SYSTEM — kosmetik, tidak ngaruh ke stats
// ══════════════════════════════════════════════════════════════
const ROD_SKINS = {
    default:    { name: 'Default',       emoji: '🎣', price: 0,       desc: 'Tampilan standar.' },
    golden:     { name: 'Golden',        emoji: '🌟', price: 5000000, desc: 'Rod berlapis emas.' },
    neon:       { name: 'Neon',          emoji: '💚', price: 8000000, desc: 'Bercahaya di kegelapan.' },
    ocean:      { name: 'Ocean',         emoji: '🌊', price: 12000000,desc: 'Motif ombak samudra.' },
    sakura:     { name: 'Sakura',        emoji: '🌸', price: 15000000,desc: 'Motif bunga sakura Jepang.' },
    dragon:     { name: 'Dragon',        emoji: '🐉', price: 50000000,desc: 'Bersisik seperti naga.' },
    cosmic:     { name: 'Cosmic',        emoji: '🌌', price: 0,       desc: 'Hanya bisa didapat dari gacha SSR.', gacha:true },
    void:       { name: 'Void',          emoji: '🌑', price: 0,       desc: 'Hanya dari token store.',  token:100 },
    rainbow:    { name: 'Rainbow',       emoji: '🌈', price: 0,       desc: 'Reward achievement 50 pts.',ach:50 },
};

// ══════════════════════════════════════════════════════════════
//   FISHING STREAK — combo mancing berturut-turut tanpa gagal
// ══════════════════════════════════════════════════════════════
const STREAK_BONUSES = [
    { streak: 3,   bonus: 1.1,  label: '🔥 3 Streak!',  desc: '+10% sell value' },
    { streak: 5,   bonus: 1.2,  label: '🔥🔥 5 Streak!', desc: '+20% sell value' },
    { streak: 10,  bonus: 1.35, label: '⚡ 10 Streak!',  desc: '+35% sell value + luck bonus' },
    { streak: 20,  bonus: 1.5,  label: '💥 20 Streak!',  desc: '+50% sell value' },
    { streak: 50,  bonus: 2.0,  label: '🌋 50 Streak!',  desc: '+100% sell value + mutation bonus' },
    { streak: 100, bonus: 3.0,  label: '🌌 100 Streak!', desc: '×3 sell value + rare fish boost' },
];

function getStreakBonus(streak) {
    let bonus = { mult: 1.0, luckAdd: 0, mutAdd: 0 };
    for (const s of STREAK_BONUSES) {
        if (streak >= s.streak) {
            bonus.mult = s.bonus;
            if (streak >= 10)  bonus.luckAdd = 0.05;
            if (streak >= 50)  bonus.mutAdd  = 0.02;
            if (streak >= 100) bonus.luckAdd = 0.15;
        }
    }
    return bonus;
}

// ══════════════════════════════════════════════════════════════
//   WORLD BOSS EVENT — event khusus boss ikan raksasa
// ══════════════════════════════════════════════════════════════
const WORLD_BOSSES = [
    {
        id: 'kraken_jr',
        name: '🦑 Kraken Jr.',
        hp: 10000,
        maxHp: 10000,
        active: false,
        reward: { money: 50000000, tokens: 30, tickets: 10 },
        desc: 'Anak Kraken yang mengamuk di lautan! Semua pemain bisa serang!',
        dmgPerHit: { min: 50, max: 500 },
        contributors: {},
    },
    {
        id: 'leviathan',
        name: '🌊 Leviathan Purba',
        hp: 50000,
        maxHp: 50000,
        active: false,
        reward: { money: 500000000, tokens: 150, tickets: 50 },
        desc: 'Makhluk purba telah terbangun! Butuh kerja sama semua pemancing!',
        dmgPerHit: { min: 100, max: 1500 },
        contributors: {},
    },
];

let activeWorldBoss = null;

async function attackWorldBoss(user, client, from) {
    if (!activeWorldBoss) return null;
    const dmg = Math.floor(
        activeWorldBoss.dmgPerHit.min +
        Math.random() * (activeWorldBoss.dmgPerHit.max - activeWorldBoss.dmgPerHit.min)
    );
    activeWorldBoss.hp = Math.max(0, activeWorldBoss.hp - dmg);
    activeWorldBoss.contributors[user.id] = (activeWorldBoss.contributors[user.id] || 0) + dmg;

    if (activeWorldBoss.hp <= 0) {
        // Boss kalah — bagi reward
        const totalDmg = Object.values(activeWorldBoss.contributors).reduce((a,b)=>a+b,0);
        const boss = activeWorldBoss;
        activeWorldBoss = null;

        // Umumkan di grup
        let announce = `🎉 *${boss.name} TELAH DIKALAHKAN!*\n\n`;
        announce += `👥 Kontributor teratas:\n`;
        const sorted = Object.entries(boss.contributors).sort((a,b)=>b[1]-a[1]).slice(0,5);
        for (const [uid, d] of sorted) {
            const pct = ((d/totalDmg)*100).toFixed(1);
            announce += `  • Player ${uid}: ${formatMoney(d)} dmg (${pct}%)\n`;
        }
        announce += `\n🎁 Reward dibagi proporsional dari total prize!`;

        try { await client.sendMessage(from, { text: announce }); } catch(_){}

        return { bossKilled: true, dmg, boss };
    }
    return { bossKilled: false, dmg };
}

// ══════════════════════════════════════════════════════════════
//   FISHING MINIGAME — chance dapat bonus dari "perfect timing"
// ══════════════════════════════════════════════════════════════
// Pemain bisa kirim .reel saat mancing untuk dapat "perfect catch bonus"
// Timing random — bot simpan window waktu yang harus ditebak
const REEL_WINDOWS = new Map(); // senderNumber -> { windowStart, windowEnd, rodKey, island }

function createReelWindow(senderNumber, rodKey, island) {
    const delay = 3000 + Math.random() * 12000; // random 3-15 detik setelah .mancing
    const windowStart = Date.now() + delay;
    const windowEnd   = windowStart + 4000; // 4 detik window
    REEL_WINDOWS.set(senderNumber, { windowStart, windowEnd, rodKey, island });
    return { delay, windowStart, windowEnd };
}

function checkReelTiming(senderNumber) {
    const w = REEL_WINDOWS.get(senderNumber);
    if (!w) return 'no_session';
    const now = Date.now();
    if (now < w.windowStart) return 'too_early';
    if (now > w.windowEnd)   return 'too_late';
    REEL_WINDOWS.delete(senderNumber);
    return 'perfect';
}

// ══════════════════════════════════════════════════════════════
//   FISHING STREAK PER USER (in-memory, reset saat server restart)
// ══════════════════════════════════════════════════════════════
const FISHING_STREAKS = new Map(); // senderNumber -> streak count

const mutations = {
  "Universe": { "multiplier": 24, "chance": 0.00001 },
  "Frozen": { "multiplier": 21, "chance": 0.00001 },
  "Phoenix": { "multiplier": 19, "chance": 0.00001 },
  "Seeker": { "multiplier": 17.8, "chance": 0.00001 },
  "Tryhard": { "multiplier": 17, "chance": 0.0005 },
  "Darkness": { "multiplier": 16.8, "chance": 0.0005 },
  "Mossy": { "multiplier": 16.5, "chance": 0.0005 },
  "Mastered": { "multiplier": 16, "chance": 0.0005 },
  "Glowy": { "multiplier": 15, "chance": 0.0007 },
  "Umbra": { "multiplier": 15, "chance": 0.0007 },
  "Evil": { "multiplier": 15, "chance": 0.0007 },
  "Nocturnal": { "multiplier": 14.2, "chance": 0.0008 },
  "Serene": { "multiplier": 14, "chance": 0.0008 },
  "Diurnal": { "multiplier": 13.5, "chance": 0.0008 },
  "Atomic": { "multiplier": 12, "chance": 0.001 },
  "Chaotic": { "multiplier": 12, "chance": 0.001 },
  "Glacial": { "multiplier": 12, "chance": 0.001 },
  "Oscar": { "multiplier": 12, "chance": 0.001 },
  "Puritas": { "multiplier": 10.7, "chance": 0.0015 },
  "Snowy": { "multiplier": 10, "chance": 0.002 },
  "Blessed": { "multiplier": 10, "chance": 0.002 },
  "Infernal": { "multiplier": 10, "chance": 0.002 },
  "Tentacle Surge": { "multiplier": 10, "chance": 0.002 },
  "Breezed": { "multiplier": 10, "chance": 0.002 },
  "Flora": { "multiplier": 10, "chance": 0.002 },
  "Luminescent": { "multiplier": 9, "chance": 0.0025 },
  "Carrot": { "multiplier": 8, "chance": 0.003 },
  "Nuclear": { "multiplier": 8, "chance": 0.003 },
  "Rainbow Cluster": { "multiplier": 8, "chance": 0.003 },
  "Chilled": { "multiplier": 8, "chance": 0.003 },
  "Prismize": { "multiplier": 8, "chance": 0.003 },
  "Sanguine": { "multiplier": 8, "chance": 0.003 },
  "Toxic": { "multiplier": 8, "chance": 0.003 },
  "Sacratus": { "multiplier": 7.7, "chance": 0.0035 },
  "Nova": { "multiplier": 7.5, "chance": 0.0035 },
  "Shrouded": { "multiplier": 7.5, "chance": 0.0035 },
  "Stardust": { "multiplier": 7.5, "chance": 0.0035 },
  "Levitas": { "multiplier": 7, "chance": 0.004 },
  "Aurora": { "multiplier": 6.5, "chance": 0.0045 },
  "Wrath": { "multiplier": 6.5, "chance": 0.0045 },
  "Astral": { "multiplier": 6, "chance": 0.005 },
  "Gemstone": { "multiplier": 6, "chance": 0.005 },
  "Heavenly": { "multiplier": 6, "chance": 0.005 },
  "Crimson": { "multiplier": 6, "chance": 0.005 },
  "Lost": { "multiplier": 5.5, "chance": 0.006 },
  "Ashen Fortune": { "multiplier": 5, "chance": 0.007 },
  "Bloom": { "multiplier": 5, "chance": 0.007 },
  "Colossal Ink": { "multiplier": 5, "chance": 0.007 },
  "Cursed Touch": { "multiplier": 5, "chance": 0.007 },
  "Emberflame": { "multiplier": 5, "chance": 0.007 },
  "Galactic": { "multiplier": 5, "chance": 0.007 },
  "Lobster": { "multiplier": 5, "chance": 0.007 },
  "Nullified": { "multiplier": 5, "chance": 0.007 },
  "Subspace": { "multiplier": 5, "chance": 0.007 },
  "Quiet": { "multiplier": 5, "chance": 0.007 },
  "Mythical": { "multiplier": 4.5, "chance": 0.008 },
  "Anomalous": { "multiplier": 4.44, "chance": 0.008 },
  "Spirit": { "multiplier": 4.2, "chance": 0.008 },
  "Aureolin": { "multiplier": 4, "chance": 0.009 },
  "Greedy": { "multiplier": 4, "chance": 0.009 },
  "Revitalized": { "multiplier": 4, "chance": 0.009 },
  "Sunken": { "multiplier": 4, "chance": 0.009 },
  "Abyssal": { "multiplier": 3.5, "chance": 0.01 },
  "Aurulent": { "multiplier": 3.5, "chance": 0.01 },
  "Electric Shock": { "multiplier": 3.5, "chance": 0.01 },
  "Vined": { "multiplier": 3.5, "chance": 0.01 },
  "Atlantean": { "multiplier": 3, "chance": 0.012 },
  "Aureate": { "multiplier": 3, "chance": 0.012 },
  "Blighted": { "multiplier": 3, "chance": 0.012 },
  "Brown Wood": { "multiplier": 3, "chance": 0.012 },
  "Celestial": { "multiplier": 3, "chance": 0.012 },
  "Cracked": { "multiplier": 3, "chance": 0.012 },
  "Crystalized": { "multiplier": 3, "chance": 0.012 },
  "Ember": { "multiplier": 3, "chance": 0.012 },
  "Green Leaf": { "multiplier": 3, "chance": 0.012 },
  "Mother Nature": { "multiplier": 3, "chance": 0.012 },
  "Aurelian": { "multiplier": 2.5, "chance": 0.015 },
  "Fossilized": { "multiplier": 2.5, "chance": 0.015 },
  "Lunar": { "multiplier": 2.5, "chance": 0.015 },
  "Scorched": { "multiplier": 2.5, "chance": 0.015 },
  "Solarblaze": { "multiplier": 2.5, "chance": 0.015 },
  "Sleet": { "multiplier": 2.4, "chance": 0.018 },
  "Moon-Kissed": { "multiplier": 2.2, "chance": 0.02 },
  "Aurous": { "multiplier": 2, "chance": 0.025 },
  "Midas": { "multiplier": 2, "chance": 0.025 },
  "Giant": { "multiplier": 2, "chance": 0.03 },
  "Purified": { "multiplier": 2, "chance": 0.03 },
  "Sparkling": { "multiplier": 1.85, "chance": 0.05 },
  "Glossy": { "multiplier": 1.6, "chance": 0.06 },
  "Silver": { "multiplier": 1.6, "chance": 0.06 },
  "Brother": { "multiplier": 1.5, "chance": 0.07 },
  "Big": { "multiplier": 1.5, "chance": 0.08 },
  // ── NEW MUTATIONS ────────────────────────────
  "Transparent": { "multiplier": 2.2, "chance": 0.025 },
  "Metallic": { "multiplier": 2.8, "chance": 0.018 },
  "Bioluminescent": { "multiplier": 3.2, "chance": 0.014 },
  "Ancient": { "multiplier": 3.8, "chance": 0.012 },
  "Radioactive": { "multiplier": 4.2, "chance": 0.009 },
  "Crystalline": { "multiplier": 4.8, "chance": 0.007 },
  "Void-Touched": { "multiplier": 5.5, "chance": 0.006 },
  "Mythweaver": { "multiplier": 6.2, "chance": 0.005 },
  "Starborn": { "multiplier": 7.0, "chance": 0.004 },
  "Primordial": { "multiplier": 8.5, "chance": 0.003 },
  "Dreambreaker": { "multiplier": 10.5, "chance": 0.002 },
  "Sovereign": { "multiplier": 13.0, "chance": 0.001 },
  "Omniscient": { "multiplier": 16.0, "chance": 0.0008 },
  "Transcendent": { "multiplier": 20.0, "chance": 0.00005 },
  "Absolute": { "multiplier": 30.0, "chance": 0.00001 }
};

// ===== MESSAGE HANDLER =====

module.exports = async (client, m, chatUpdate, store) => {
    try {
        // ── Skip pesan sistem — tidak perlu diproses ──────────
        const _mtype = m?.mtype || Object.keys(m?.message || {})[0] || '';
        const SKIP_TYPES = [
            'protocolMessage', 'senderKeyDistributionMessage',
            'reactionMessage', 'readReceiptMessage',
            'pollCreationMessage', 'pollUpdateMessage',
            'callLogMesssage', 'callLogMessage',
        ];
        if (SKIP_TYPES.includes(_mtype)) return;

        // ── Parse body dari semua tipe pesan ─────────────────
        const body = (() => {
            try {
                if (m.mtype === 'conversation')               return m.message?.conversation || '';
                if (m.mtype === 'extendedTextMessage')        return m.message?.extendedTextMessage?.text || '';
                if (m.mtype === 'imageMessage')               return m.message?.imageMessage?.caption || '';
                if (m.mtype === 'videoMessage')               return m.message?.videoMessage?.caption || '';
                if (m.mtype === 'documentMessage')            return m.message?.documentMessage?.caption || '';
                if (m.mtype === 'buttonsResponseMessage')     return m.message?.buttonsResponseMessage?.selectedButtonId || '';
                if (m.mtype === 'listResponseMessage')        return m.message?.listResponseMessage?.singleSelectReply?.selectedRowId || '';
                if (m.mtype === 'templateButtonReplyMessage') return m.msg?.selectedId || '';
                if (m.mtype === 'interactiveResponseMessage') {
                    try { return JSON.parse(m.msg?.nativeFlowResponseMessage?.paramsJson || '{}')?.id || ''; } catch { return ''; }
                }
                return m.body || m.text || '';
            } catch { return m.body || m.text || ''; }
        })();

        // ── Routing info (harus DULU sebelum sender) ─────────
        const from    = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        // ── Sender info ───────────────────────────────────────
        const sender = m.key.fromMe
            ? client.decodeJid(client.user.id)
            : (isGroup
                ? (m.key.participant || m.participant || '')
                : from);
        const senderNumber = (sender || '').split('@')[0];
        const budy = body;

        // ── Prefix & command parsing ──────────────────────────
        const prefixRegex = /^[.!#$/\\]/;
        const prefix    = body && prefixRegex.test(body) ? body[0] : '.';
        const bodyClean = body.replace(/@\d+/g, '').trim();
        const botNumber = await client.decodeJid(client.user.id);
        const isBot     = botNumber.includes(senderNumber);

        const isCmd   = body.startsWith(prefix) || bodyClean.startsWith(prefix);
        const _cmdBody = body.startsWith(prefix) ? body : bodyClean;
        const command = isCmd ? _cmdBody.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
        const args    = isCmd ? _cmdBody.slice(prefix.length).trim().split(/\s+/).slice(1) : [];
        const pushname = m.pushName || 'No Name';
        const q    = args.join(' ');
        const text = q;
        const quoted = m.quoted ? m.quoted : m;
        const mime   = (quoted.msg || quoted).mimetype || '';
        const qmsg   = (quoted.msg || quoted);
        const isMedia = /image|video|sticker|audio/.test(mime);

        // ── Group metadata ────────────────────────────────────
        // Gunakan isGroup (dari from.endsWith) — lebih reliable dari m?.isGroup
        const groupMetadata  = isGroup ? await client.groupMetadata(from).catch(() => ({})) : {};
        const groupName      = isGroup ? (groupMetadata.subject || '') : '';
        const participants   = isGroup ? (groupMetadata.participants || []).map(p => ({
            id: p.id || null, jid: p.id || null,
            admin: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : null,
            full: p
        })) : [];
        const groupOwner    = isGroup ? (participants.find(p => p.admin === 'superadmin')?.jid || '') : '';
        const groupAdmins   = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.jid || p.id);
        const isBotAdmins   = isGroup ? groupAdmins.includes(botNumber) : false;
        const isAdmins      = isGroup ? groupAdmins.includes(m.sender) : false;
        const isGroupOwner  = isGroup ? groupOwner === m.sender : false;

        // ── Log incoming message ──────────────────────────────
        if (m.message) {
            const bodyPreview = String(body || m.mtype || '-').slice(0, 80);
            console.log(chalk.bgHex('#4a69bd').bold(' ▢ New Message '));
            console.log(chalk.cyan(`   Tanggal : ${new Date().toLocaleString()}`));
            console.log(chalk.white(`   Pesan   : ${bodyPreview}`));
            console.log(chalk.white(`   Dari    : ${pushname} [${senderNumber}]`));
        }

        // ── Helpers ───────────────────────────────────────────
        const reaction = async (jidss, emoji) => {
            try { await client.sendMessage(jidss, { react: { text: emoji, key: m.key } }); } catch (_) {}
        };

        const reply = async (teks) => {
            try {
                return await client.sendMessage(m.chat, { text: String(teks) }, { quoted: m });
            } catch (e) {
                // fallback tanpa quoted
                try { return await client.sendMessage(m.chat, { text: String(teks) }); } catch (_) {}
            }
        };

        // ── Plugin loader ─────────────────────────────────────
        const pluginsLoader = (dir) => {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(file => {
                try {
                    const fp = path.join(dir, file);
                    delete require.cache[require.resolve(fp)];
                    return require(fp);
                } catch (e) { console.error(`[Plugin] ${file}:`, e.message); return null; }
            }).filter(Boolean);
        };

        const plugins = pluginsLoader(path.resolve(__dirname, './command'));
        const plug = { client, prefix, command, reply, text, isBot, reaction, pushname, mime, quoted, sleep, fquoted, fetchJson };

        for (const plugin of plugins) {
            if (typeof plugin !== 'function') continue;
            if (!Array.isArray(plugin.command)) continue;
            if (!plugin.command.includes(command)) continue;
            if (plugin.isBot && !isBot) continue;
            if (plugin.private && isGroup) { await reply(config.message.private); continue; }
            await plugin(m, plug);
        }

        // ── Command switch ────────────────────────────────────
        if (!isCmd || !command) return;
        // Guard: jangan proses kalau body kosong atau hanya spasi
        if (!body?.trim()) return;

        switch (command) {

        case "menu": {
    reply(
`╔══════════════════════════╗
║    🐟  FISCH BOT  ${config.version.padEnd(8)}║
╚══════════════════════════╝

👋 Halo *${pushname}*!

🎣 *FISHING*
• .mancing       — Mulai memancing
• .view          — Ambil hasil tangkapan
• .inventory     — Lihat inventory ikan
• .jual          — Jual semua ikan
• .fishbook      — Koleksi ikan unik
• .mutationbook  — Koleksi mutasi ikan
• .top           — Leaderboard pemain

💰 *EKONOMI*
• .money         — Cek saldo kamu
• .transfer <user> <jml> — Kirim uang
• .gift <user> <id>     — Kirim ikan

🏝️ *PULAU & ROD*
• .travel        — Daftar & pindah pulau
• .shop          — Toko fishing rod
• .buy <rod>     — Beli rod
• .equip <rod>   — Pasang rod aktif
• .listrod       — Rod yang kamu miliki
• .enchant       — Enchant rod aktif
• .listenchant   — Daftar enchantment

👥 *SOSIAL*
• .me            — Profil kamu
• .player <u>    — Profil pemain lain
• .addfriend <u> — Tambah teman
• .delfriend <u> — Hapus teman
• .f-accept <u>  — Terima request teman
• .f-decline <u> — Tolak request teman
• .requestfriends — Permintaan masuk
• .listfriend    — Daftar teman
• .rename <nama> — Ganti username
• .resetme       — Reset akun (hati-hati!)

👑 *PRESTIGE & SISTEM*
• .prestige      — Cek info & syarat prestige
• .prestige confirm — Konfirmasi naik prestige
• .tokenstore    — Toko prestige token
• .stats         — Lihat semua stats
• .upgrade       — Upgrade stats permanen
• .daily         — Ambil reward harian
• .gacha         — Gacha rod & reward
• .jackpot       — Gambling uang
• .donate        — Donasi untuk season points
• .rodupgrade    — Upgrade rod permanen
• .event         — Info event aktif
• .season        — Info season & leaderboard
• .seasonhistory — Riwayat season

📱 *TELEGRAM*
• .linktele      — Hubungkan ke Telegram
• .unlinktele    — Putus koneksi Telegram
• .teleinfo      — Info koneksi Telegram

ℹ️ *INFO*
• .version       — Versi bot
• .ping          — Cek respons bot`
    );
}
break;

        case "version": {
    reply(
        `ℹ️ *Fisch Bot*\n` +
        `📦 Versi: *${config.version}*\n` +
        `🔧 Platform: WhatsApp + Telegram\n` +
        `📡 Database: MongoDB\n` +
        `⚡ Engine: Baileys @whiskeysockets`
    );
    break;
}

        case "ping": {
    const start = Date.now();
    await client.sendMessage(from, { text: "🏓 Pong!" }, { quoted: m });
    const end = Date.now();
    reply(`🏓 *Pong!*\n⚡ Respons: *${end - start}ms*`);
    break;
}

// ===== TELEGRAM LINK COMMANDS =====
        case "linktele": {
    const user = await getOrCreateUser(senderNumber);

    // Cek sudah terhubung?
    if (user.isVerifiedTelegram && user.telegramId) {
        const tgUsername = user.telegramUsername ? `@${user.telegramUsername}` : `ID: ${user.telegramId}`;
        return reply(
            `✅ Akun WA kamu sudah terhubung ke Telegram!\n` +
            `📱 Telegram: *${tgUsername}*\n` +
            `🆔 Connect ID: ${user.telegramConnectID || '-'}\n\n` +
            `Ketik *.unlinktele* jika ingin putuskan koneksi.`
        );
    }

    // Hapus session lama jika ada
    await TelegramSession.deleteMany({ tempWhatsAppNumber: senderNumber });

    // Generate kode 6 digit
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

    await TelegramSession.create({
        tempTelegramId: 'pending-' + senderNumber,
        tempWhatsAppNumber: senderNumber,
        verificationCode: code,
        expiresAt
    });

    reply(
        `🔗 *Hubungkan ke Telegram*\n\n` +
        `Kode verifikasi kamu:\n` +
        `┌─────────────────┐\n` +
        `│   *${code}*   │\n` +
        `└─────────────────┘\n\n` +
        `📋 *Cara menghubungkan:*\n` +
        `1️⃣ Buka bot Telegram kamu\n` +
        `2️⃣ Kirim perintah: \`/confirm ${code}\`\n\n` +
        `⏳ Kode berlaku *5 menit*\n` +
        `⚠️ Jangan bagikan kode ini ke siapapun!`
    );
    break;
}

        case "unlinktele": {
    const user = await getOrCreateUser(senderNumber);

    if (!user.isVerifiedTelegram && !user.telegramId) {
        return reply('⚠️ Akun WA kamu belum terhubung ke Telegram.');
    }

    const oldTelegramId = user.telegramId;
    user.isVerifiedTelegram = false;
    user.telegramId = null;
    user.telegramUUID = null;
    user.telegramConnectID = null;
    user.telegramUsername = null;
    await user.save();
    await TelegramSession.deleteMany({ tempWhatsAppNumber: senderNumber });

    reply('✅ Koneksi Telegram berhasil diputus!\nKetik *.linktele* untuk menghubungkan ulang.');
    break;
}

        case "teleinfo": {
    const user = await getOrCreateUser(senderNumber);
    const status = user.isVerifiedTelegram && user.telegramId;

    if (!status) {
        return reply(
            `📱 *Status Telegram*\n\n` +
            `❌ Belum terhubung\n\n` +
            `Ketik *.linktele* untuk menghubungkan!`
        );
    }

    const tgUsername = user.telegramUsername ? `@${user.telegramUsername}` : `(no username)`;
    reply(
        `📱 *Status Telegram*\n\n` +
        `✅ Terhubung\n` +
        `📌 Telegram: *${tgUsername}*\n` +
        `🆔 ID: ${user.telegramId}\\n` +
        `🔑 Connect ID: ${user.telegramConnectID || '-'}\\n` +
        `🔄 UUID: ${user.telegramUUID || '-'}`
    );
    break;
}
// ===== END TELEGRAM LINK COMMANDS =====

        case "resetalltelegramsesi": {
    if (!botAdmins.includes(senderNumber)) 
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");

    try {
        const result = await TelegramSession.deleteMany({});
        reply(`✅ Semua sesi Telegram sementara telah dihapus.\nJumlah sesi yang dihapus: ${result.deletedCount}`);
        console.log(`[RESET WA] Semua sesi Telegram sementara dihapus. Jumlah: ${result.deletedCount}`);
    } catch (err) {
        reply("❌ Terjadi kesalahan saat mereset sesi Telegram. Coba lagi nanti.");
    }
    break;
}

        case "importdata": {
    if (!botAdmins.includes(senderNumber)) {
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");
    }

    reply("🔄 Sedang mengimpor data dari fishing.json...");

    try {
        const resultMessage = await importFishingJSON();
        reply(resultMessage);
    } catch (err) {
        reply("❌ Terjadi kesalahan saat mengimpor data.");
    }
}
break;


        case "gift": {
    const user = await getOrCreateUser(senderNumber);
    if (!user) return reply("⚠️ Akun kamu tidak ditemukan di database!");

    if (!args[0] || !args[1])
        return reply("❌ Format salah!\nContoh: *.gift <username/ID> <id_ikan>*");

    const targetArg = args[0].trim();
    const fishId = args[1].trim();

    const receiver = await Player.findOne({
        $or: [
            { id: targetArg },
            { username: new RegExp(`^${targetArg}$`, "i") }
        ]
    });

    if (!receiver)
        return reply("❌ Player dengan ID atau username itu tidak ditemukan!");

    if (receiver.id === user.id)
        return reply("❌ Kamu tidak bisa mengirim ikan ke diri sendiri!");

    if (!user.friends?.includes(receiver.id))
        return reply("⚠️ Kamu harus menjadi teman dengan user ini terlebih dahulu untuk mengirim gift.");

    if (!Array.isArray(user.inventory) || user.inventory.length === 0)
        return reply("🎣 Inventory kamu kosong!");

    const fishIndex = user.inventory.findIndex(f => f.id === fishId && f.type === "fish");
    if (fishIndex === -1)
        return reply(`❌ Ikan dengan ID *${fishId}* tidak ditemukan di inventory kamu.`);

    const fish = user.inventory.splice(fishIndex, 1)[0];

    if (!Array.isArray(receiver.inventory)) receiver.inventory = [];
    receiver.inventory.push(fish);

    await user.save();
    await receiver.save();

    reply(`🎁 Kamu mengirim ikan *${fish.name}* (ID: ${fish.id}) ke *${receiver.username}* (ID: ${receiver.id})`);

        if (receiver.whatsappNumber && typeof client?.sendMessage === "function") {
            await client.sendMessage(receiver.whatsappNumber + "@s.whatsapp.net", {
                text: `🎣 Kamu menerima ikan *${fish.name}* (ID: ${fish.id}) dari *${user.username}*!`
            });
        }
}
break;

        case "setmoney": {
    if (!botAdmins.includes(senderNumber))
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");

    if (args.length < 2)
        return reply("⚙️ Format: .setmoney <username/ID> <jumlah>");

    const targetName = args[0];
    const amountInput = args[1].replace(/[^\d]/g, "");

    const target = await findUserByIdOrName(targetName);
    if (!target)
        return reply("❌ Player tidak ditemukan!");

    const amount = parseInt(amountInput);
    if (isNaN(amount) || amount < 0)
        return reply("❌ Jumlah tidak valid!");

    target.money = amount;

    await target.save();

    reply(`✅ Uang ${target.username} telah diatur menjadi *💰 ${formatMoney(amount)}*`);
    break;
}

        case "forceenchant": {
    if (!botAdmins.includes(senderNumber))
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");

    if (args.length < 3)
        return reply("⚙️ Format: .forceenchant <username/ID> <rodName> <enchantName>");

    const targetName = args[0];
    const rodName = args[1];
    const enchantName = args.slice(2).join(" ");

    const target = await findUserByIdOrName(targetName);
    if (!target) return reply("❌ Player tidak ditemukan!");

    if (!target.fishingRods)
        return reply("🎣 Player ini belum memiliki fishing rod.");

    const rodKey = rodName.toLowerCase().replace(/\s+/g, "");
    const rod = target.fishingRods.get(rodKey);
    if (!rod)
        return reply(`🎣 Player ini tidak memiliki rod bernama *${rodName}*.`);

    const enchantKey = enchantName.toLowerCase().replace(/\s+/g, "");
    const validEnchant = rodEnchants[enchantKey];
    if (!validEnchant)
        return reply(`⚠️ Enchant *${enchantName}* tidak ditemukan di daftar enchant!`);

    rod.enchant = enchantKey;
    await target.save();

    reply(`✅ Rod *${rod.name || rodName}* milik *${target.username}* berhasil di-enchant dengan *${validEnchant.name || enchantName}*!`);
    break;
}

        case "setlevel": {
    if (!botAdmins.includes(senderNumber))
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");

    if (args.length < 2)
        return reply("⚙️ Format: .setlevel <username/ID> <level>");

    const target = await findUserByIdOrName(args[0]);
    if (!target) return reply("❌ Player tidak ditemukan!");

    const level = parseInt(args[1]);
    if (isNaN(level) || level < 0)
        return reply("❌ Level tidak valid!");

    if (!target.level) target.level = 0;
    target.level = level;
    await target.save();

    reply(`✅ Level *${target.username}* telah diatur menjadi *Level ${level}*`);
    break;
}

        case "setfishcaught": {
    if (!botAdmins.includes(senderNumber)) {
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");
    }

    if (!args[0] || !args[1]) {
        return reply("⚙️ Format: .setfishcaught <username/ID> <jumlah>");
    }

    const query = args[0];
    const amount = parseInt(args[1].replace(/,/g, ""));

    if (isNaN(amount) || amount < 0)
        return reply("❌ Jumlah tidak valid!");

    const filter = isNaN(query)
        ? { username: { $regex: new RegExp(`^${query}$`, "i") } }
        : { id: Number(query) };

    const target = await Player.findOne(filter);

    if (!target)
        return reply("❌ Player tidak ditemukan!");

    target.fishCaught = amount;
    await target.save();

    reply(`✅ Jumlah ikan yang ditangkap oleh *${target.username}* telah diatur menjadi *${formatMoney(amount)} ikan*!`);
    break;
}

        case "resetall": {
    if (!botAdmins.includes(senderNumber)) {
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");
    }

    reply("🗑️ Sedang menghapus semua data player...");

    try {
        const result = await Player.deleteMany({});
        reply(`✅ Semua akun telah dihapus! Total dokumen yang dihapus: ${result.deletedCount}`);
    } catch (err) {
        reply("❌ Terjadi kesalahan saat menghapus data player.");
    }

    break;
}

        case "addmoney": {
    if (!botAdmins.includes(senderNumber)) {
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");
    }

    if (!args[0] || !args[1]) {
        return reply("⚠️ Format: .addmoney <username/ID> <jumlah>\nContoh: .addmoney hann 1B");
    }

    const targetQuery = args[0];
    const amountText = args[1].toUpperCase();

    const amount = parseAmount(amountText);
    if (isNaN(amount) || amount <= 0)
        return reply("⚠️ Jumlah tidak valid! Gunakan format seperti `100K`, `5M`, `1.2B`");

    const target = await Player.findOne({
        $or: [
            { username: new RegExp(`^${targetQuery}$`, "i") },
            { id: targetQuery }
        ]
    });

    if (!target) return reply("❌ Player tidak ditemukan!");

    target.money = (target.money || 0) + amount;
    await target.save();

    reply(`✅ Berhasil menambahkan ${formatMoney(amount)} ke *${target.username}*.\n💰 Total sekarang: ${formatMoney(target.money)}`);
    break;
}

        case "database": {
    if (!botAdmins.includes(senderNumber))
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");

        const players = await Player.find().lean();
        const tempPath = path.join(__dirname, "player_backup.json");
        fs.writeFileSync(tempPath, JSON.stringify(players, null, 2));

        await client.sendMessage(m.chat, {
            document: fs.readFileSync(tempPath),
            mimetype: "application/json",
            fileName: "player_backup.json"
        }, { quoted: m });

        fs.unlinkSync(tempPath);

    break;
}

        case "transfer": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0] || !args[1])
        return reply("⚠️ Format: .transfer <username/id> <jumlah>\nContoh: .transfer hann 1B");

    const targetQuery = args[0];
    const amountText = args[1].toUpperCase();

    const amount = parseAmount(amountText);
    if (isNaN(amount) || amount <= 0)
        return reply("⚠️ Jumlah transfer tidak valid!\nGunakan format seperti 100K, 5M, 1.2B");

    const target = await Player.findOne({
        $or: [
            { username: new RegExp(`^${targetQuery}$`, "i") },
            { id: targetQuery }
        ]
    });

    if (!target)
        return reply("❌ User tujuan tidak ditemukan.");

    if (target.id === user.id)
        return reply("⚠️ Kamu tidak bisa transfer ke diri sendiri!");

    if (!user.friends.includes(target.id))
        return reply("⚠️ Kamu harus menjadi teman dengan user ini terlebih dahulu untuk melakukan transfer.");

    if (user.money < amount)
        return reply("💸 Uang kamu tidak cukup untuk transfer ini.");

    user.money -= amount;
    target.money += amount;

    await user.save();
    await target.save();

    reply(`✅ Berhasil mentransfer ${formatMoney(amount)} ke *${target.username}* (ID: ${target.id})`);

    if (target.whatsappNumber && typeof client?.sendMessage === "function") {
        const receiverJid = `${target.whatsappNumber}@s.whatsapp.net`;
        await client.sendMessage(receiverJid, {
            text: `💰 *${user.username}* baru saja mengirim kamu ${formatMoney(amount)}! 🎁`
        });
    }

    // Notif Telegram ke penerima jika sudah link
    if (target.isVerifiedTelegram && target.telegramId) {
        await notifyTelegram(target.telegramId,
            `💸 *Transfer masuk!*\n` +
            `Dari: *${target.username ? user.username : 'Seseorang'}*\n` +
            `Jumlah: *${formatMoney(amount)}* coins\n` +
            `Saldo baru: *${formatMoney(target.money)}* coins`
        );
    }

    break;
}
        case "money": {
    const user = await getOrCreateUser(senderNumber);

    reply(`💰 ${user.username}, Kamu mempunyai ${formatMoney(user.money)} money`);
    break;
}

        case "listrod": {
    const user = await getOrCreateUser(senderNumber);

    const rodsMap = user.fishingRods;
    if (!rodsMap || rodsMap.size === 0) return reply("⚠️ Kamu belum memiliki pancingan apapun.");

    const equippedKey = user.usedFishingRod;
    const rows = [];
    for (const [key, rod] of rodsMap.entries()) {
        const isEquipped = key === equippedKey;
        rows.push({
            id: `equip_${key}`,
            title: `${isEquipped ? "⚡ [EQUIPPED] " : ""}${rod.name || key}`,
            description: `Lv.${rod.level}/${rod.maxLevel} | EXP:${rod.exp}/${rod.expToNextLevel} | 🍀${(rod.mutationsLuck*100).toFixed(2)}% | ⚡${(rod.speed*100).toFixed(1)}%`
        });
    }

    let rodText = `🎣 *Fishing Rods Kamu* (${rodsMap.size} rod)\n`;
    rodText += `⚡ Equipped: *${equippedKey}*\n`;
    rodText += `${'─'.repeat(28)}\n`;
    for (const [key, rod] of rodsMap.entries()) {
        const eq = key === equippedKey;
        rodText += `\n${eq ? '⚡ *[EQUIPPED]*' : '🔹'} *${rod.name || key}*`;
        if (rod.enchant) rodText += ` ✨${rod.enchant}`;
        rodText += `\n`;
        rodText += `  Lv.${rod.level}/${rod.maxLevel} | EXP: ${rod.exp}/${rod.expToNextLevel}\n`;
        rodText += `  🍀 Luck: ${(rod.luck*100).toFixed(1)}% | ⚡ Speed: ${(rod.speed*100).toFixed(1)}%\n`;
        rodText += `  🧬 MutLuck: ${(rod.mutationsLuck*100).toFixed(3)}% | 💸 SellMult: x${(1+(rod.sellMultiplier||0)).toFixed(1)}\n`;
        if (!eq) rodText += `  ↳ Equip: *.equip ${key}*\n`;
    }
    rodText += `${'─'.repeat(28)}`;
    reply(rodText);
}
break;

        case "me": {
    const user = await getOrCreateUser(senderNumber);

    const timeSince = (timestamp) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        const units = [
            { label: "tahun", value: 31536000 },
            { label: "bulan", value: 2592000 },
            { label: "hari", value: 86400 },
            { label: "jam", value: 3600 },
            { label: "menit", value: 60 },
            { label: "detik", value: 1 },
        ];
        for (const u of units) {
            const v = Math.floor(seconds / u.value);
            if (v >= 1) return `${v} ${u.label} lalu`;
        }
        return "baru saja";
    };

    const rod = user.fishingRods.get(user.usedFishingRod);
    const rodProgress = `${rod.exp}/${rod.expToNextLevel}`;
    const playerProgress = `${user.exp}/${user.expToNextLevel}`;

    const msg = 
`🎣 *Profil Pemancing*
────────────────────────
📛 Nama: ${user.username}
🆔 ID: ${user.id}
💰 Uang: ${formatMoney(user.money)}
🌍 Pulau: ${user.currentIsland}

🧍 Player:
  ▫️ Level: ${user.level}/${user.maxLevel}
  ▫️ EXP: ${playerProgress}

🎣 Rod: ${rod.name}
  ▫️ Level: ${rod.level}/${rod.maxLevel}
  ▫️ EXP: ${rodProgress}

📊 Statistik
  🐟 Total Mancing: ${user.fishCaught}
  🧬 Mutasi Ditemukan: ${user.mutationFound.length}
  🐠 Ikan Ditemukan: ${user.fishFound.length}
  🎒 Inventory: ${user.inventory.length} item
  👥 Teman: ${user.friends.length}

🕒 Akun dibuat: ${timeSince(user.createdAt)}
────────────────────────`;

    reply(msg);
}
break;

        case "addfriend": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0]) return reply("⚠️ Gunakan: .addfriend <username atau ID>");

    const query = args.join(" ").toLowerCase();
    let target = null;

    if (/^\d{8}$/.test(query)) {
        target = await Player.findOne({ id: parseInt(query) });
    } else {
        target = await Player.findOne({ username: { $regex: query, $options: "i" } });
    }

    if (!target) return reply("❌ Player tidak ditemukan.");
    if (target.id === user.id) return reply("❌ Kamu tidak bisa menambahkan diri sendiri sebagai teman.");

    user.friends = user.friends || [];
    target.friends = target.friends || [];
    target.pendingFriends = target.pendingFriends || [];

    if (user.friends.includes(target.id))
        return reply(`⚠️ ${target.username} sudah menjadi temanmu.`);

    if (target.pendingFriends.includes(user.id))
        return reply(`⚠️ Kamu sudah mengirim permintaan teman ke ${target.username}.`);

    await Player.updateOne(
        { id: target.id },
        { $addToSet: { pendingFriends: user.id } }
    );

    reply(`✅ Permintaan teman ke *${target.username}* berhasil dikirim!`);

    // Notif Telegram ke target
    if (target.isVerifiedTelegram && target.telegramId) {
        await notifyTelegram(target.telegramId,
            `👥 *Permintaan pertemanan baru!*\n` +
            `*${user.username}* ingin berteman denganmu.\n` +
            `Ketik \`/acceptfriend ${user.username}\` untuk menerima.`
        );
    }
    break;
}

        case "f-accept": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0]) return reply("⚠️ Gunakan: .f-accept <username atau ID>");

    const query = args.join(" ").toLowerCase();
    let target = null;

    if (/^\d{8}$/.test(query)) {
        target = await Player.findOne({ id: parseInt(query) });
    } else {
        target = await Player.findOne({ username: { $regex: query, $options: "i" } });
    }

    if (!target) return reply("❌ Player tidak ditemukan.");

    if (!user.pendingFriends || !user.pendingFriends.includes(target.id)) {
        return reply("❌ Tidak ada permintaan teman dari player tersebut.");
    }

    await Player.updateOne(
        { id: user.id },
        { $pull: { pendingFriends: target.id } }
    );

    await Player.updateOne(
        { id: user.id },
        { $addToSet: { friends: target.id } }
    );

    await Player.updateOne(
        { id: target.id },
        { $addToSet: { friends: user.id } }
    );

    reply(`✅ Kamu menerima permintaan teman dari *${target.username}*!`);
    break;
}

        case "f-decline": {
    const user = await getOrCreateUser(senderNumber);
    if (!args[0]) return reply("⚠️ Gunakan: .f-decline <username atau ID>");

    const query = args.join(" ").toLowerCase();
    let target = null;

    if (/^\d{8}$/.test(query)) {
        target = await Player.findOne({ id: parseInt(query) });
    } else {
        target = await Player.findOne({ username: { $regex: query, $options: "i" } });
    }

    if (!target) return reply("❌ Player tidak ditemukan.");

    if (!user.pendingFriends || !user.pendingFriends.includes(target.id)) {
        return reply("❌ Tidak ada permintaan teman dari player tersebut.");
    }

    await Player.updateOne(
        { id: user.id },
        { $pull: { pendingFriends: target.id } }
    );

    await Player.updateOne(
        { id: target.id },
        { $pull: { friendsRequestSent: user.id } }
    );

    reply(`❌ Kamu menolak permintaan teman dari *${target.username}*.`);
    break;
}

        case "delfriend": {
    const user = await getOrCreateUser(senderNumber);
    if (!args[0]) return reply("⚠️ Gunakan: .delfriend <username atau ID>");

    const query = args.join(" ").toLowerCase();
    let target = null;

    if (/^\d{8}$/.test(query)) {
        target = await Player.findOne({ id: parseInt(query) });
    } else {
        target = await Player.findOne({ username: { $regex: query, $options: "i" } });
    }

    if (!target) return reply("❌ Player tidak ditemukan.");
    if (!user.friends || !user.friends.includes(target.id))
        return reply("❌ Player tersebut bukan temanmu.");

    await Player.updateOne(
        { id: user.id },
        { $pull: { friends: target.id } }
    );
    await Player.updateOne(
        { id: target.id },
        { $pull: { friends: user.id } }
    );

    reply(`✅ Teman *${target.username}* berhasil dihapus.`);
    break;
}

        case "player": {
    if (!args[0]) return reply("⚠️ Gunakan: .player <ID atau username>");

    const query = args.join(" ").toLowerCase();
    let foundUsers = [];

    if (/^\d{8}$/.test(query)) {
        const found = await Player.findOne({ id: parseInt(query) });
        if (found) foundUsers.push(found);
    } else {
        foundUsers = await Player.find({
            username: { $regex: query, $options: "i" },
        });
    }

    if (foundUsers.length === 0) {
        const allPlayers = await Player.find({}, { username: 1, id: 1, money: 1, fishingRods: 1, fishCaught: 1, mutationFound: 1 });
        const candidates = allPlayers
            .map(u => ({
                user: u,
                score: similarity(u.username.toLowerCase(), query)
            }))
            .sort((a, b) => b.score - a.score);

        if (candidates[0] && candidates[0].score > 0.4) {
            foundUsers.push(candidates[0].user);
        }
    }

    if (foundUsers.length === 0) {
        return reply("❌ Player tidak ditemukan di database.");
    }

    const totalMutations = Object.keys(mutations).length;
    let text = "";

    for (const u of foundUsers) {
        const rodsOwned = Object.keys(u.fishingRods || {}).join(", ") || "Tidak ada rod";
        const totalFishCaught = u.fishCaught || 0;
        const totalMutationsFound = u.mutationFound?.length || 0;

        text += `🎣 Username: ${u.username}\n` +
                `🆔 ID: ${u.id}\n` +
                `💰 Money: ${formatMoney(u.money || 0)}\n` +
                `🎣 Rod dimiliki: ${rodsOwned}\n` +
                `🐟 Total ikan ditangkap: ${totalFishCaught}\n` +
                `🧬 Mutasi ditemukan: ${totalMutationsFound}/${totalMutations}\n\n`;
    }

    reply(text.trim());
    break;
}

        case "requestfriends":
        case "rfriends": {
    const user = await getOrCreateUser(senderNumber);

    if (!user || !user.pendingFriends || user.pendingFriends.length === 0) {
        return reply("⚠️ Kamu tidak memiliki permintaan teman yang tertunda.");
    }

    const pending = await Player.find({ id: { $in: user.pendingFriends } });

    if (pending.length === 0)
        return reply("⚠️ Tidak ditemukan data permintaan teman di database.");

    let text = "📨 Permintaan Teman Tertunda:\n\n";
    for (const p of pending) {
        text += `• ${p.username || "Tanpa Nama"} (ID: ${p.id}) 💰${formatMoney(p.money || 0)}\n`;
    }

    reply(text.trim());
    break;
}

        case "listfriend": {
    const user = await getOrCreateUser(senderNumber);
    if (!user || !user.friends || user.friends.length === 0) {
        return reply("⚠️ Kamu belum memiliki teman. Gunakan *.addfriend <username/ID>* untuk menambah teman!");
    }

    const friends = await Player.find({ id: { $in: user.friends } });

    if (friends.length === 0)
        return reply("⚠️ Tidak ditemukan data teman di database.");

    let friendText = `👥 *Daftar Teman ${user.username}* (${friends.length})\n${'─'.repeat(28)}\n`;
    friends.forEach((f, i) => {
        friendText += `\n${i+1}. 👤 *${f.username || "Tanpa Nama"}* [ID: ${f.id}]\n`;
        friendText += `   💰 ${formatMoney(f.money||0)} | 🌍 ${f.currentIsland||"mousewood"} | Lv.${f.level} | 🐟 ${f.fishCaught||0}x\n`;
        friendText += `   ↳ Lihat: *.player ${f.id}*\n`;
    });
    friendText += `${'─'.repeat(28)}`;
    reply(friendText);
    break;
}

        case "resetme": {
    const user = await getOrCreateUser(senderNumber);

    if (!user) return reply("❌ User tidak ditemukan.");

    await Player.updateMany(
        {},
        {
            $pull: {
                friends: user.id,
                pendingFriends: user.id
            }
        }
    );

    const oldId = user.id;
    const oldCreatedAt = user.createdAt;
    const oldWhatsapp = user.whatsappNumber;
    const oldTelegramId = user.telegramId;

    user.set({
        username: await generateUniqueUsername(),
        money: 200,
        inventory: [],
        level: 1,
        exp: 0,
        expToNextLevel: 100,
        maxLevel: 9999,
        usedFishingRod: "basicrod",
        fishingRods: {
            basicrod: {
                name: "Basic Fishing Rod",
                type: "rod",
                luck: 0.00,
                speed: 0.00,
                comboFish: 1,
                comboMutations: 1,
                mutationsLuck: 0.000,
                sellMultiplier: 0.0,
                price: 0,
                enchant: null,
                bonusStats: {},
                description: "",
                level: 1,
                maxLevel: 5,
                exp: 0,
                expToNextLevel: 100,
                enchantCount: 0
            }
        },
        currentIsland: "mousewood",
        fishingPending: [],
        fishFound: [],
        mutationFound: [],
        friends: [],
        pendingFriends: [],
        travelFound: [],
        fishCaught: 0,
        isVerifiedTelegram: false,
        whatsappNumber: oldWhatsapp,
        telegramId: oldTelegramId,
        telegramUUID: null,
        telegramConnectID: null,
        id: oldId,
        createdAt: oldCreatedAt
    });

    await user.save();

    reply("✅ Akun kamu telah di-reset sepenuhnya! ID, tanggal pembuatan, dan akun terhubung tetap sama, semua progress hilang.");
}
break;
        case "equip": {
  const user = await getOrCreateUser(senderNumber);

  if (!args[0])
    return reply("⚠️ Format: .equip <nama_rod>");

  const rodKey = args.join(" ").toLowerCase().replace(/\s+/g, '');

  if (!user.fishingRods || !user.fishingRods.get(rodKey))
    return reply("❌ Kamu belum memiliki pancingan ini.");

  user.usedFishingRod = rodKey;

  await user.save();

  const rod = user.fishingRods.get(rodKey); 
  reply(`🎣 Pancingan aktif kamu sekarang adalah *${rod.name}*!`);
}
break;

        case "buy": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0])
        return reply("⚠️ Format: .buy <nama_rod>");

    const rodKey = args[0].toLowerCase().replace(/\s+/g, '');
    const rodData = fishingRod[rodKey];

    if (!rodData)
        return reply("❌ Pancingan tidak ditemukan.");

    if (rodData.userSetting === "developer" && !botAdmins.includes(senderNumber))
        return reply("⚠️ Rod ini hanya bisa dibeli oleh developer bot!");

    if (rodData.price <= 0)
        return reply("❌ Pancingan ini tidak bisa dibeli.");

    if (!user.fishingRods) user.fishingRods = {};

    if (user.fishingRods[rodKey])
    return reply(`⚠️ Kamu sudah memiliki *${rodData.name}*.`);

    if (user.money < rodData.price)
        return reply(`💵 Kamu butuh ${formatMoney(rodData.price)} money untuk membeli ${rodData.name}.`);
        
        user.money -= rodData.price;
        
        if (!(user.fishingRods instanceof Map)) {
          user.fishingRods = new Map(Object.entries(user.fishingRods || {}));
        }
        
        user.fishingRods.set(rodKey, rodData);
        await user.save();
        
        reply(`✅ Berhasil membeli *${rodData.name}*! 🎣`);
}
break;

        case "shop": {
  const user = await getOrCreateUser(senderNumber);

  const rodsForSale = Object.entries(fishingRod)
    .filter(([_, rod]) => rod.price > 0 && rod.userSetting !== "developer")
    .sort((a, b) => a[1].price - b[1].price);

  if (rodsForSale.length === 0)
    return reply("❌ Tidak ada pancingan yang dijual saat ini.");

  const rows = rodsForSale.map(([key, rod]) => {
    const owned = user.fishingRods?.get(key);
    return {
        id: `buy_${key}`,
        title: `${owned ? "✅ " : ""}${rod.name}`,
        description: `💰 ${formatMoney(rod.price)} | 🍀 ${(rod.mutationsLuck*100).toFixed(2)}% | 🎯 ${(rod.luck*100).toFixed(1)}% | ⚡ ${(rod.speed*100).toFixed(1)}%`
    };
  });

  let shopText = `🛒 *Toko Fishing Rod*\n`;
  shopText += `💰 Saldo kamu: *${formatMoney(user.money)}*\n`;
  shopText += `✅ = sudah dimiliki\n${'─'.repeat(28)}\n`;
  rodsForSale.forEach(([key, rod], i) => {
    const owned = user.fishingRods?.get(key);
    shopText += `\n${owned ? '✅' : `${i+1}.`} *${rod.name}*\n`;
    shopText += `   💰 Harga: ${formatMoney(rod.price)}\n`;
    shopText += `   🍀 Luck: ${(rod.luck*100).toFixed(1)}% | ⚡ Speed: ${(rod.speed*100).toFixed(1)}%\n`;
    shopText += `   🧬 MutLuck: ${(rod.mutationsLuck*100).toFixed(3)}% | 💸 SellMult: x${(1+(rod.sellMultiplier||0)).toFixed(1)}\n`;
    shopText += `   🔺 Max Lv: ${rod.maxLevel} | Combo: ${rod.comboFish}🐟 ${rod.comboMutations}🧬\n`;
    if (!owned) shopText += `   ↳ Beli: *.buy ${key}*\n`;
  });
  shopText += `${'─'.repeat(28)}`;
  reply(shopText);
}
break;

        case "listenchant": {
    const enchantKeys = Object.keys(rodEnchants);
    if (enchantKeys.length === 0)
        return reply("⚠️ Belum ada enchant yang tersedia.");

    const RE = { common:"⚪",rare:"🟢",epic:"🔵",legendary:"🟡",mythic:"🟣",godly:"🌈",secret:"⚫" };
    const RORDER = ["common","rare","epic","legendary","mythic","godly","secret"];

    // Group by rarity
    const grouped = {};
    for (const key of enchantKeys) {
        const ench = rodEnchants[key];
        const r = ench.rarity || "common";
        if (!grouped[r]) grouped[r] = [];
        grouped[r].push({ key, ench });
    }

    let encText = `✨ *Daftar Enchantment* (${enchantKeys.length} total)\n${'─'.repeat(28)}\n`;
    for (const rarity of RORDER) {
        const grp = grouped[rarity];
        if (!grp) continue;
        encText += `\n${RE[rarity] || "❔"} *${rarity.toUpperCase()}*\n`;
        grp.forEach(({ key, ench }) => {
            const effStr = Object.entries(ench.effect || {}).map(([k, v]) => {
                let dv = typeof v === "number"
                    ? (v > 2 ? `${v}×` : v > 1 ? `+${((v-1)*100).toFixed(0)}%` : `${(v*100).toFixed(1)}%`)
                    : v;
                return `${k}:${dv}`;
            }).join(" | ");
            encText += `  • *${ench.name}* — ${ench.desc || ""}\n`;
            encText += `    💠 ${effStr}\n`;
        });
    }
    encText += `${'─'.repeat(28)}\n_Gunakan *.enchant* untuk memasang enchant ke rod aktifmu_`;
    reply(encText);
}
break;
  
        case "rename": {
  const user = await getOrCreateUser(senderNumber);

  if (!args[0])
    return reply(`⚠️ Format: *.rename <nama_baru>*\nContoh: .rename hann`);

  const newName = args.join(" ").trim().toLowerCase();

  if (newName.length < 3 || newName.length > 20)
    return reply("❌ Nama harus antara 3–20 karakter.");

  if (!/^[a-z0-9 ]+$/.test(newName))
    return reply("❌ Nama hanya boleh mengandung huruf kecil, angka, dan spasi.");

  const nameTaken = await Player.exists({ username: newName }); 
  if (nameTaken)
    return reply(`⚠️ Nama *${newName}* sudah dipakai pemain lain.\nSilakan pilih nama lain.`);

  const oldName = user.username || "Player";
  user.username = newName;

  await user.save(); 
  
  reply(`✅ Nama berhasil diganti!\n\n👤 *${oldName}* → *${newName}*`);
}
break;
  
        case "enchant": {
    const user = await getOrCreateUser(senderNumber);
    const rodKey = user.usedFishingRod;
    const rod = user.fishingRods.get(rodKey);
    if (!rod) return reply("⚠️ Kamu belum memiliki fishing rod aktif!");

    rod.enchantCount = rod.enchantCount || 0;

    const baseCost = 50000;
    const extraPerEnchant = 50000;
    const cost = baseCost + (rod.enchantCount * extraPerEnchant);

    // Jika args[0] === "confirm" → langsung enchant
    if (args[0] === "confirm") {
        if (user.money < cost)
            return reply(`💸 Uang kamu tidak cukup! Butuh ${formatMoney(cost)} money.`);

        const rarityChances = [
            { rarity: "common", chance: 40 },
            { rarity: "rare", chance: 25 },
            { rarity: "epic", chance: 15 },
            { rarity: "legendary", chance: 10 },
            { rarity: "mythic", chance: 6 },
            { rarity: "godly", chance: 3 },
            { rarity: "secret", chance: 1 }
        ];

        const roll = Math.random() * 100;
        let selectedRarity;
        let cumulative = 0;
        for (const r of rarityChances) {
            cumulative += r.chance;
            if (roll <= cumulative) { selectedRarity = r.rarity; break; }
        }

        const possibleEnchants = Object.entries(rodEnchants)
            .filter(([_, e]) => e.rarity === selectedRarity);

        if (possibleEnchants.length === 0)
            return reply("⚠️ Tidak ada enchant dengan rarity itu!");

        const [randomKey, randomEnchant] =
            possibleEnchants[Math.floor(Math.random() * possibleEnchants.length)];

        const oldEnchant = rod.enchant ? rodEnchants[rod.enchant]?.name : null;

        rod.enchant = randomKey;
        rod.enchantCount++;
        user.money -= cost;

        user.markModified(`fishingRods.${rodKey}`);
        await user.save();

        return reply(
            `🔮 *Enchant Berhasil!*\n\n` +
            `🎣 Rod: ${rod.name}\n` +
            (oldEnchant ? `✨ Enchant lama: ${oldEnchant}\n` : ``) +
            `🌈 Enchant baru: *${randomEnchant.name}*\n` +
            `💎 Rarity: ${selectedRarity.toUpperCase()}\n` +
            `📜 Deskripsi: ${randomEnchant.desc}\n\n` +
            `💸 Biaya: ${formatMoney(cost)}\n` +
            `💰 Uang tersisa: ${formatMoney(user.money)}`
        );
    }

    // Tampilkan info, user ketik .enchant confirm untuk lanjut
    const currentEnchant = rod.enchant ? rodEnchants[rod.enchant] : null;
    reply(
        `🔮 *Info Enchant Rod*\n${'─'.repeat(28)}\n\n` +
        `🎣 Rod: *${rod.name}*\n` +
        `✨ Enchant sekarang: *${currentEnchant ? currentEnchant.name : "Tidak ada"}*\n` +
        `🔢 Enchant ke-: *${rod.enchantCount + 1}*\n\n` +
        `💰 Biaya: *${formatMoney(cost)}*\n` +
        `💵 Saldo: *${formatMoney(user.money)}*\n\n` +
        `⚠️ Enchant bersifat *acak*\n` +
        `Enchant lama akan *diganti*!\n\n` +
        `${'─'.repeat(28)}\n` +
        `✅ Lanjut → ketik *.enchant confirm*\n` +
        `❌ Batal → abaikan pesan ini`
    );
}
break;

        case "refreshall": {
    if (!botAdmins.includes(senderNumber))
        return reply("⚠️ Hanya admin yang bisa menggunakan perintah ini!");

    reply("🔄 Sedang melakukan refresh semua data player Fisch di MongoDB...");

    const players = await Player.find({});
    let refreshedCount = 0;

    for (const player of players) {
        const oldRods = player.fishingRods || {};
        const newRods = {};

        for (const rodKey in oldRods) {
            if (fishingRod[rodKey]) {
                newRods[rodKey] = {
                    ...fishingRod[rodKey],
                    enchant: oldRods[rodKey].enchant ?? null,
                    exp: oldRods[rodKey].exp ?? 0,
                    enchantCount: oldRods[rodKey].enchantCount ?? 0,
                };
            }
        }

        for (const rodKey in fishingRod) {
            if (!newRods[rodKey]) newRods[rodKey] = { ...fishingRod[rodKey] };
        }

        await Player.updateOne(
            { id: player.id },
            {
                $set: {
                    username: player.username,
                    money: player.money ?? 200,
                    fishingRods: newRods,
                    usedFishingRod: player.usedFishingRod ?? "basicrod",
                    currentIsland: player.currentIsland ?? "mousewood",
                    inventory: Array.isArray(player.inventory) ? player.inventory : [],
                    level: player.level ?? 1,
                    exp: player.exp ?? 0,
                    expToNextLevel: player.expToNextLevel ?? 100,
                    maxLevel: player.maxLevel ?? 9999,
                    fishingPending: Array.isArray(player.fishingPending) ? player.fishingPending : [],
                    fishFound: Array.isArray(player.fishFound) ? player.fishFound : [],
                    mutationFound: Array.isArray(player.mutationFound) ? player.mutationFound : [],
                    createdAt: player.createdAt || Date.now(),
                    friends: Array.isArray(player.friends) ? player.friends : [],
                    pendingFriends: Array.isArray(player.pendingFriends) ? player.pendingFriends : [],
                    travelFound: Array.isArray(player.travelFound) ? player.travelFound : ["mousewood"],
                    fishCaught: player.fishCaught ?? 0,
                    isVerifiedTelegram: player.isVerifiedTelegram ?? false,
                    whatsappNumber: player.whatsappNumber ?? null,
                    telegramId: player.telegramId ?? null,
                    telegramUUID: player.telegramUUID ?? null,
                    telegramConnectID: player.telegramConnectID ?? null,
                },
            }
        );

        refreshedCount++;
    }

    reply(`✅ Refresh MongoDB selesai!\n🎣 Total player diperbarui: *${refreshedCount}*`);
}
break;
  
        case "mancing":
        case "fish": {
    const user = await getOrCreateUser(senderNumber);
    const rod = user.fishingRods.get(user.usedFishingRod);
    if (!rod) return reply("❌ Kamu belum punya fishing rod! Beli dulu di *.shop*");

    const now   = Date.now();
    const island = user.currentIsland || "mousewood";
    const islandData = islands[island];
    const pending = user.fishingPending.find(p => p.sender === senderNumber);

    // Sudah ada tangkapan siap
    if (pending && now >= pending.readyAt) {
        return reply(
            `🐟 *Ikan Sudah Menggigit!*\n` +
            `🏝️ Pulau: *${islandData?.name || island}*\n` +
            `🌦️ Cuaca: ${CURRENT_WEATHER.name}\n\n` +
            `Ikanmu siap diambil!\n` +
            `Ketik *.view* untuk mengambil tangkapanmu!\n` +
            `🎯 Atau *.reel* sekarang untuk Perfect Catch Bonus!`
        );
    }

    // Masih mancing
    if (pending) {
        const remaining = ((pending.readyAt - now) / 1000).toFixed(1);
        const streak = FISHING_STREAKS.get(senderNumber) || 0;
        const streakTxt = streak >= 3 ? `\n🔥 Streak: *${streak}x*` : '';
        return reply(
            `🎣 *Sedang Memancing...*\n` +
            `🏝️ Pulau: *${islandData?.name || island}*\n` +
            `🌦️ Cuaca: ${CURRENT_WEATHER.name}\n` +
            `🎣 Rod: *${rod.name}*${streakTxt}\n\n` +
            `⏳ Tunggu *${remaining} detik* lagi.\n` +
            `Ketik *.reel* tepat saat ikan menggigit untuk bonus!`
        );
    }

    // Cek island cooldown
    const cdSec = ISLAND_COOLDOWNS[island] || 0;
    if (cdSec > 0) {
        const lastFish = (user.islandCooldowns || {})[island] || 0;
        const cdLeft   = Math.ceil((lastFish + cdSec * 1000 - now) / 1000);
        if (cdLeft > 0) {
            return reply(
                `⏰ *Cooldown Pulau ${islandData?.name}*\n\n` +
                `Kamu baru saja mancing di sini.\n` +
                `Tunggu *${cdLeft} detik* sebelum mancing lagi.\n\n` +
                `💡 Sementara coba pindah pulau dengan *.travel*`
            );
        }
    }

    // Hitung waktu tunggu dengan cuaca
    const baseWait = 1000 * (5 + Math.random() * 7);
    const enchant  = rod.enchant ? rodEnchants[rod.enchant] : null;
    let waitMultiplier = 1;
    if (enchant?.effect?.lureSpeed)     waitMultiplier /= enchant.effect.lureSpeed;
    if (enchant?.effect?.progressSpeed) waitMultiplier /= enchant.effect.progressSpeed;
    // Cuaca mempengaruhi speed
    waitMultiplier /= (CURRENT_WEATHER.speedMult || 1);

    const waitTime = Math.max(3000, baseWait * (1 - Math.min(rod.speed, 0.95)) * waitMultiplier);

    // Setup reel minigame window
    createReelWindow(senderNumber, user.usedFishingRod, island);

    user.fishingPending.push({
        sender: senderNumber,
        start: now,
        readyAt: now + waitTime,
        rod: user.usedFishingRod,
        island,
        weather: CURRENT_WEATHER.key,
        fishes: [],
        comboFish: rod.comboFish
    });

    await user.save();

    // Cuaca & streak info
    const streak = FISHING_STREAKS.get(senderNumber) || 0;
    const streakBonus = getStreakBonus(streak);
    const streakTxt = streak >= 3 ? `\n🔥 Streak: *${streak}x* (Sell ×${streakBonus.mult.toFixed(2)})` : '';
    const weatherTxt = CURRENT_WEATHER.key !== 'sunny' ? `\n🌦️ *Cuaca: ${CURRENT_WEATHER.name}*\n   ${CURRENT_WEATHER.desc}` : '';
    const enchantInfo = enchant ? ` ✨${enchant.name}` : '';

    const caption =
        `🎣 *Mulai Memancing!*\n${'─'.repeat(28)}\n\n` +
        `🏝️ Pulau: *${islandData?.name || island}*\n` +
        `🎣 Rod: *${rod.name}${enchantInfo}*\n` +
        `🍀 Luck: ${((rod.luck||0)*100).toFixed(1)}% | ⚡ Speed: ${((rod.speed||0)*100).toFixed(1)}%` +
        weatherTxt + streakTxt + `\n\n` +
        `⏳ Ikan menggigit dalam *${(waitTime/1000).toFixed(1)} detik*\n` +
        `🎯 Kirim *.reel* saat ikan menggigit untuk bonus!\n` +
        `Atau *.view* untuk ambil hasil.`;

    if (islandData?.image) {
        await client.sendMessage(m.chat, {
            image: { url: islandData.image },
            caption,
            mimetype: "image/jpeg"
        }, { quoted: m });
    } else {
        reply(caption);
    }
}
break;

        case "travel": {
    const user = await getOrCreateUser(senderNumber);
    if (!Array.isArray(user.travelFound)) user.travelFound = [];

    if (!args[0]) {
        const islandKeys = Object.keys(islands);
        const unlockedRows = [];
        const lockedRows = [];

        for (const isle of islandKeys) {
            const unlocked = user.travelFound.includes(isle) || isle === "mousewood";
            const isCurrent = user.currentIsland === isle;
            const displayName = islands[isle]?.name || isle;
            const req = travelRequirements?.[isle];
            const row = {
                id: `travel_${isle}`,
                title: `${isCurrent ? "📍 " : unlocked ? "✅ " : "🔒 "}${displayName}`,
                description: isCurrent
                    ? "Lokasi kamu saat ini"
                    : unlocked
                        ? `Ketik .travel ${isle} untuk pergi`
                        : req ? `Butuh 💰${formatMoney(req.money)} & 🎣${req.fish}x mancing` : "Belum tersedia"
            };
            if (unlocked) unlockedRows.push(row);
            else lockedRows.push(row);
        }

        const sections = [];
        if (unlockedRows.length > 0) sections.push({ title: "✅ Pulau Terbuka", rows: unlockedRows });
        if (lockedRows.length > 0) sections.push({ title: "🔒 Pulau Terkunci", rows: lockedRows });

        let travelText = `🧭 *Travel Menu*\n`;
        travelText += `📍 Saat ini: *${islands[user.currentIsland]?.name || user.currentIsland}*\n`;
        travelText += `${'─'.repeat(28)}\n`;
        if (unlockedRows.length > 0) {
            travelText += `\n✅ *Pulau Terbuka*\n`;
            unlockedRows.forEach(r => {
                const key = r.id.replace('travel_', '');
                const isCur = key === user.currentIsland;
                travelText += `  ${isCur ? '📍' : '•'} *${islands[key]?.name || key}*`;
                if (!isCur) travelText += ` → *.travel ${key}*`;
                travelText += `\n`;
            });
        }
        if (lockedRows.length > 0) {
            travelText += `\n🔒 *Pulau Terkunci*\n`;
            lockedRows.forEach(r => {
                const key = r.id.replace('travel_', '');
                const req = travelRequirements?.[key];
                travelText += `  🔒 *${islands[key]?.name || key}*\n`;
                if (req) travelText += `     💰 ${formatMoney(req.money)} | 🎣 ${req.fish}x mancing\n`;
            });
        }
        travelText += `${'─'.repeat(28)}\n_Gunakan *.travel <nama_pulau>* untuk pindah_`;
        return reply(travelText);
    }

    const target = args[0].toLowerCase();
    if (!islands[target]) return reply(`❌ Pulau *${target}* tidak ditemukan!`);

    if (user.currentIsland === target)
        return reply(`⚠️ Kamu sudah berada di *${islands[target].name}*!`);

    if (user.travelFound.includes(target) || target === "mousewood") {
        user.currentIsland = target;
        await Player.updateOne(
            { id: user.id },
            { $set: { currentIsland: target } }
        );

        return reply(
            `🛶 Kamu berlayar ke *${islands[target].name}*!\n\n` +
            (target !== "mousewood" ? `🎣 Sekarang kamu bisa memancing ikan khas pulau ini!` : "")
        );
    }

    const req = travelRequirements[target];
    if (!req)
        return reply(`🔒 Pulau *${islands[target].name}* belum bisa kamu akses untuk saat ini.`);

    if (user.money < req.money || (user.fishCaught || 0) < req.fish) {
        return reply(
            `🔒 Kamu belum memenuhi syarat untuk menuju *${islands[target].name}*.\n\n` +
            `Syarat yang dibutuhkan:\n` +
            `💰 ${formatMoney(req.money)} money\n` +
            `🎣 Mancing minimal ${req.fish} kali\n\n` +
            `Kamu saat ini:\n💵 ${formatMoney(user.money)} money\n🐟 ${user.fishCaught || 0} kali`
        );
    }

    user.money -= req.money;
    user.travelFound.push(target);
    user.currentIsland = target;

    await Player.updateOne(
        { id: user.id },
        {
            $set: {
                money: user.money,
                currentIsland: user.currentIsland,
                travelFound: user.travelFound
            }
        }
    );

    return reply(
        `🔥 Selamat! Kamu berhasil membuka akses ke pulau baru *${islands[target].name}*! 🎉\n\n` +
        `💸 Uang kamu berkurang ${formatMoney(req.money)} money.\n` +
        req.message
    );
}
break;

        case "mutationbook":
        case "mb": {
    const user = await getOrCreateUser(senderNumber); 
    
    if (!user.mutationFound) user.mutationFound = [];

    let text = `🧬 *Mutation Book*\n\n`;
    text += `Daftar mutasi ikan yang sudah kamu temukan:\n\n`;

    const totalMutations = Object.keys(mutations).length;
    let ownedCount = 0;

    for (const [mutationName, mutationData] of Object.entries(mutations)) {
        const owned = user.mutationFound.includes(mutationName);
        const mark = owned ? "✅" : "❌";
        text += `${mark} ${mutationName} — 💥 ×${mutationData.multiplier}\n`;
        if (owned) ownedCount++;
    }

    text += `\n🎯 ${ownedCount}/${totalMutations} mutasi sudah kamu temukan!`;

    await reply(text);
}
break;

        case "fishbook":
        case "fb": {
    const user = await getOrCreateUser(senderNumber); 
    
    if (!user.fishFound) user.fishFound = [];

    let text = `📖 *Fish Book*\n\n`;
    text += `Daftar ikan yang sudah kamu temukan di semua pulau:\n\n`;

    let totalFish = 0;
    let ownedCount = 0;

    for (const [islandName, islandData] of Object.entries(islands)) {
        text += `🏝️ *${islandName.charAt(0).toUpperCase() + islandName.slice(1)}*\n`;

        for (const fish of islandData.listFish) {
            const owned = user.fishFound.includes(fish.name);
            const mark = owned ? "✅" : "❌";
            text += `${mark} ${fish.name} (${fish.rarity})\n`;
            totalFish++;
            if (owned) ownedCount++;
        }

        text += "\n";
    }

    text += `🎯 ${ownedCount}/${totalFish} ikan sudah kamu temukan!`;

    await reply(text);
}
break;

        case "top":
        case "leaderboard": {
  const allPlayers = await Player.find({});
  if (!allPlayers.length) return reply("📊 Belum ada data pemain.");

  const user = await getOrCreateUser(senderNumber);

  const sortedMoney = allPlayers
    .filter(p => p.money != null)
    .sort((a, b) => (b.money || 0) - (a.money || 0));

  const rankMoney =
    sortedMoney.findIndex(p => p.id === user.id) + 1 || allPlayers.length;

  let textTop = `🏆 *Leaderboard Pemancing Terkaya*\n\n`;
  sortedMoney.slice(0, 10).forEach((u, i) => {
    textTop += `${i + 1}. ${u.username} — 💵 ${formatMoney(u.money || 0)}\n`;
  });
  textTop += `\n📍 Posisi kamu (uang): #${rankMoney}/${allPlayers.length}\n\n`;
  
  const sortedFish = allPlayers
    .filter(p => p.fishCaught != null)
    .sort((a, b) => (b.fishCaught || 0) - (a.fishCaught || 0));

  const rankFish =
    sortedFish.findIndex(p => p.id === user.id) + 1 || allPlayers.length;

  textTop += `🎣 *Leaderboard Pemancing Mania*\n\n`;
  sortedFish.slice(0, 10).forEach((u, i) => {
    textTop += `${i + 1}. ${u.username} — 🎣 ${u.fishCaught || 0} kali mancing\n`;
  });
  textTop += `\n📍 Posisi kamu (mancing): #${rankFish}/${allPlayers.length}\n\n`;

  const sortedLevel = allPlayers
    .filter(p => p.level != null)
    .sort((a, b) => (b.level || 0) - (a.level || 0));

  const rankLevel =
    sortedLevel.findIndex(p => p.id === user.id) + 1 || allPlayers.length;

  textTop += `🧠 *Leaderboard Level Tertinggi*\n\n`;
  sortedLevel.slice(0, 10).forEach((u, i) => {
    textTop += `${i + 1}. ${u.username} — 🧍 Level ${u.level || 1}\n`;
  });
  textTop += `\n📍 Posisi kamu (level): #${rankLevel}/${allPlayers.length}`;

  reply(textTop);
}
break;

        case "view": {
    const user = await getOrCreateUser(senderNumber);
    const rodKey = user.usedFishingRod;
    const rod    = user.fishingRods.get(rodKey);
    const pending= user.fishingPending.find(p => p.sender === senderNumber);
    const now    = Date.now();

    if (!pending) return reply("❌ Kamu belum memancing. Kirim *.mancing* dulu!");

    if (now < pending.readyAt) {
        const remaining = ((pending.readyAt - now) / 1000).toFixed(0);
        return reply(
            `⏳ *Belum Menggigit!*\n\n` +
            `🐟 Ikan masih berenang... tunggu *${remaining} detik* lagi.\n` +
            `🎯 Kirim *.reel* tepat saat ikan menggigit untuk Perfect Catch!`
        );
    }

    // Generate ikan dengan semua sistem baru
    const totalFish  = rod.comboFish || 1;
    const results    = [];
    const weather    = WEATHERS[pending.weather] || CURRENT_WEATHER;
    const streak     = FISHING_STREAKS.get(senderNumber) || 0;
    const streakBon  = getStreakBonus(streak);
    let rareFishThisSession = 0;

    for (let i = 0; i < totalFish; i++) {
        const upgStats = getUpgradedStats(user, rod);
        // Tambahkan luck dari cuaca + streak
        upgStats.luck = (upgStats.luck || 0) + ((weather.luckMult || 1) - 1) + (streakBon.luckAdd || 0);
        const rodEff  = { ...rod, ...upgStats };
        const fish    = getRandomFish(rodEff, pending.island || "mousewood");

        // Fish Condition
        const condition = rollFishCondition();
        if (condition.id !== 'normal') {
            fish.condition = condition;
            fish.price = Math.round(fish.price * condition.priceBonus);
            fish.conditionLabel = condition.label;
        }

        // Streak sell bonus
        fish.price = Math.round(fish.price * streakBon.mult);

        // Cuaca rarity boost
        if (weather.rarityBoost?.[fish.rarity]) {
            fish.price = Math.round(fish.price * weather.rarityBoost[fish.rarity]);
        }

        fish.id = generateId();
        results.push(fish);
        user.inventory.push(fish);

        if (!user.fishFound.includes(fish.name)) user.fishFound.push(fish.name);

        // Track biggest fish
        if (!user.biggestFish || fish.kg > user.biggestFish.kg) {
            user.biggestFish = { name: fish.name, kg: fish.kg, price: fish.price, date: new Date() };
        }

        // Track rare fish
        const rareRarities = ['rare','epic','legendary','mythic','godly','secret','extinct'];
        if (rareRarities.includes(fish.rarity)) {
            user.rareFishCaught = (user.rareFishCaught || 0) + 1;
            rareFishThisSession++;
        }

        // Track mutationFound
        if (fish.isMutated) {
            for (const mut of fish.mutations) {
                if (mut !== 'Normal' && !user.mutationFound.includes(mut)) {
                    user.mutationFound.push(mut);
                }
            }
        }
    }

    user.fishingPending = user.fishingPending.filter(p => p.sender !== senderNumber);
    user.fishCaught     = (user.fishCaught || 0) + results.length;

    // Update island cooldown
    if (!user.islandCooldowns) user.islandCooldowns = {};
    user.islandCooldowns[pending.island] = now;
    user.markModified('islandCooldowns');

    // Consume bait
    const usedBait = (user.inventory || []).find(i => i.type === 'bait');
    if (usedBait) {
        const bIdx = user.inventory.findIndex(i => i.type === 'bait' && i.itemId === usedBait.itemId);
        if (bIdx > -1) user.inventory.splice(bIdx, 1);
    }

    // Season points
    for (const fish of results) { addSeasonPoints(user, fish); }

    // Event multiplier
    const eventMult   = ACTIVE_EVENT.active ? ACTIVE_EVENT.multiplier : 1;
    const weatherMult = 1; // sudah diapply per ikan
    const totalValue  = results.reduce((a, b) => a + b.price, 0);
    const totalMoney  = Math.floor(totalValue * eventMult);
    const expGainRod  = totalMoney / 20;
    const expGainPlayer = totalMoney / 15;

    // Update total earned
    user.totalEarned = (user.totalEarned || 0) + totalMoney;

    // Update streak
    const allNonCommon = results.every(f => f.rarity !== 'common');
    if (allNonCommon && results.length > 0) {
        FISHING_STREAKS.set(senderNumber, streak + results.length);
    } else {
        FISHING_STREAKS.set(senderNumber, 0);
    }
    const newStreak = FISHING_STREAKS.get(senderNumber) || 0;

    // Check achievements
    const newAchs = await checkAchievements(user, {
        fish: results[0],
        weather: pending.weather,
        moonlight: pending.weather === 'moonlight'
    });

    const levelUpRodMsg    = await addRodExp(user, rodKey, expGainRod);
    const levelUpPlayerMsg = addPlayerExp(user, expGainPlayer);

    // World boss attack saat view
    let bossMsg = '';
    if (activeWorldBoss) {
        const bossResult = await attackWorldBoss(user, client, from);
        if (bossResult) {
            bossMsg = bossResult.bossKilled
                ? `\n\n⚔️ *${activeWorldBoss?.name || 'Boss'} DIKALAHKAN!* (dmg: ${formatMoney(bossResult.dmg)})`
                : `\n\n⚔️ Seranganmu ke ${activeWorldBoss.name}: *${formatMoney(bossResult.dmg)} dmg* | HP: ${formatMoney(activeWorldBoss.hp)}/${formatMoney(activeWorldBoss.maxHp)}`;
        }
    }

    await user.save();

    // Format output
    const RARITY_EMOJI = {
        common:'⚪',uncommon:'🟢',rare:'💚',epic:'💙',legendary:'💛',
        mythic:'🟣',godly:'🌟',secret:'⚫',extinct:'🦕',special:'✨',exotic:'🟠'
    };

    const fishListText = results.map(f => {
        const mutText = (f.mutations?.length && f.mutations[0] !== 'Normal')
            ? ` [${f.mutations.join(', ')}]` : '';
        const condText = f.conditionLabel ? ` ${f.conditionLabel}` : '';
        const emoji = RARITY_EMOJI[f.rarity] || '🐟';
        return `${emoji} *${f.name}*${condText} _(${f.rarity})_${mutText}\n` +
               `   ⚖️ ${f.kg}kg × 💰${formatMoney(f.pricePerKg)}/kg = 💵 *${formatMoney(f.price)}*`;
    }).join('\n\n');

    const enchantText   = rod.enchant ? ` ✨ ${rodEnchants[rod.enchant]?.name || rod.enchant}` : '';
    const weatherText   = weather.key !== 'sunny' ? `\n🌦️ Cuaca: ${weather.name}` : '';
    const streakText    = newStreak >= 3 ? `\n🔥 Streak: *${newStreak}x* (Sell ×${getStreakBonus(newStreak).mult.toFixed(2)})` : '';
    const eventText     = ACTIVE_EVENT.active ? `\n🎪 Event Bonus: *×${eventMult}*` : '';
    const achieveText   = newAchs.length > 0
        ? '\n\n🏆 *Achievement Baru!*\n' + newAchs.map(a=>`   ${a.name} (+${a.pts} pts)`).join('\n')
        : '';

    await reply([
        `🎣 *Hasil Pancingan — ${islands[pending.island]?.name || pending.island}!*\n${'─'.repeat(30)}\n\n` +
        fishListText +
        `\n\n💰 Total nilai: *${formatMoney(totalMoney)} money*` +
        eventText + weatherText + streakText +
        `\n🎣 Menggunakan: *${rod.name}${enchantText}*\n` +
        `🧠 EXP Rod: +${formatMoney(expGainRod)} | 👤 EXP Player: +${formatMoney(expGainPlayer)}` +
        bossMsg + achieveText,
        levelUpRodMsg,
        levelUpPlayerMsg,
    ].filter(Boolean).join('\n\n'));
}
break;

        case "jual":
        case "sell": {
    const user = await getOrCreateUser(senderNumber);
    const arg0 = args[0]?.toLowerCase();
    
    let fishToSell = user.inventory.filter(item => item.type === "fish");
    if (fishToSell.length === 0) return reply("📦 Tidak ada ikan yang bisa dijual.");

    // .jual rare+ → jual hanya rare ke atas
    // .jual common → jual hanya common
    // .jual all / kosong → jual semua
    const RARITY_ORDER = ['common','uncommon','rare','epic','legendary','mythic','godly','secret','extinct','special'];
    if (arg0 && arg0 !== 'all' && arg0 !== 'semua') {
        const filterRarity = arg0;
        if (filterRarity.endsWith('+')) {
            const base = filterRarity.slice(0,-1);
            const baseIdx = RARITY_ORDER.indexOf(base);
            if (baseIdx >= 0) fishToSell = fishToSell.filter(f => RARITY_ORDER.indexOf(f.rarity) >= baseIdx);
            else return reply(`❌ Rarity "${base}" tidak dikenal. Gunakan: common, rare, epic, legendary, dll`);
        } else {
            const targetIdx = RARITY_ORDER.indexOf(filterRarity);
            if (targetIdx >= 0) fishToSell = fishToSell.filter(f => f.rarity === filterRarity);
            else if (filterRarity === 'mutated' || filterRarity === 'mutasi') {
                fishToSell = fishToSell.filter(f => f.isMutated);
            } else return reply(`❌ Filter tidak dikenal. Contoh: *.jual common*, *.jual rare+*, *.jual mutasi*`);
        }
    }

    if (fishToSell.length === 0) return reply(`📦 Tidak ada ikan yang cocok untuk dijual dengan filter "*${arg0}*".`);

    const totalMoney  = fishToSell.reduce((a, b) => a + (b.price || 0), 0);
    const totalWeight = fishToSell.reduce((a, b) => a + (b.kg || 0), 0);
    const jumlah      = fishToSell.length;
    const sellIds     = new Set(fishToSell.map(f => f.id));

    // Grouping untuk summary
    const byRarity = {};
    for (const f of fishToSell) {
        if (!byRarity[f.rarity]) byRarity[f.rarity] = { count:0, total:0 };
        byRarity[f.rarity].count++;
        byRarity[f.rarity].total += f.price || 0;
    }

    user.money   = (user.money || 0) + totalMoney;
    user.totalEarned = (user.totalEarned || 0) + totalMoney;
    user.inventory   = user.inventory.filter(item => !(item.type === "fish" && sellIds.has(item.id)));

    const RARITY_EMOJI = { common:'⚪',uncommon:'🟢',rare:'💚',epic:'💙',legendary:'💛',mythic:'🟣',godly:'🌟',secret:'⚫',extinct:'🦕',special:'✨' };
    const summaryLines = Object.entries(byRarity)
        .sort((a,b) => RARITY_ORDER.indexOf(b[0]) - RARITY_ORDER.indexOf(a[0]))
        .map(([r,d]) => `  ${RARITY_EMOJI[r]||'🐟'} ${r}: ${d.count} ekor → ${formatMoney(d.total)}`);

    // Check achievements setelah jual
    const newAchs = await checkAchievements(user, {});
    await user.save();

    const achText = newAchs.length > 0
        ? '\n\n🏆 *Achievement Baru!*\n' + newAchs.map(a=>`   ${a.name} (+${a.pts} pts)`).join('\n')
        : '';

    reply(
        `💰 *Hasil Penjualan Ikan*\n${'─'.repeat(28)}\n` +
        summaryLines.join('\n') + '\n' +
        `${'─'.repeat(28)}\n` +
        `🐟 Terjual: *${jumlah} ekor* | ⚖️ *${totalWeight.toFixed(2)} kg*\n` +
        `💵 Pendapatan: *${formatMoney(totalMoney)} money*\n` +
        `💰 Saldo: *${formatMoney(user.money)}*\n\n` +
        `💡 Filter: *.jual common* | *.jual rare+* | *.jual mutasi*` +
        achText
    );
}

break;

// ════════════════════════════════════════════════════════════
//   SEASON COMMANDS
// ════════════════════════════════════════════════════════════
        case "season":
        case "s": {
    const user = await getOrCreateUser(senderNumber);
    const timeLeft = currentSeason.endDate.getTime() - Date.now();
    const daysLeft  = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    // Top 5 season
    const top5 = await Player.find({ seasonPoints: { $gt: 0 } })
        .sort({ seasonPoints: -1 }).limit(5).lean();

    let text = `🏆 *${currentSeason.name}*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📅 Mulai: ${currentSeason.startDate.toLocaleDateString('id-ID')}\n`;
    text += `⏳ Sisa: *${daysLeft}h ${hoursLeft}j* lagi\n`;
    text += `📅 Berakhir: ${currentSeason.endDate.toLocaleDateString('id-ID')}\n\n`;
    text += `🎁 *Hadiah Pemenang:*\n`;
    text += `🥇 OMEGA ROD + 500 Tokens + 10T coins\n`;
    text += `🥈 Cosmic Rod + 200 Tokens + 1T coins\n`;
    text += `🥉 Void Rod + 100 Tokens + 100B coins\n\n`;
    text += `📊 *Leaderboard Season:*\n`;
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    top5.forEach((p, i) => {
        const isMe = p.id === user.id;
        text += `${medals[i]} ${isMe ? '*' : ''}${p.username}${isMe ? '*' : ''} — ${formatMoney(p.seasonPoints)} pts\n`;
    });

    // Cari posisi user sendiri
    const allSorted = await Player.find({ seasonPoints: { $gt: 0 } })
        .sort({ seasonPoints: -1 }).lean();
    const myRank = allSorted.findIndex(p => p.id === user.id) + 1;
    text += `\n📍 Posisimu: *#${myRank || 'unranked'}* | Poin: *${formatMoney(user.seasonPoints || 0)}*\n`;
    text += `\n💡 Poin dari: mancing ikan, mutasi, rarity tinggi`;

    reply(text);
    break;
}

        case "seasonhistory":
        case "seasonlog": {
    const histories = await SeasonHistory.find().sort({ seasonNumber: -1 }).limit(5).lean();
    if (!histories.length) return reply('📜 Belum ada riwayat season.');
    let text = `📜 *Riwayat Season*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const h of histories) {
        text += `🏆 *${h.name || 'Season ' + h.seasonNumber}*\n`;
        text += `📅 ${new Date(h.startDate).toLocaleDateString('id-ID')} — ${new Date(h.endDate).toLocaleDateString('id-ID')}\n`;
        if (h.winner1) text += `🥇 ${h.winner1.username} (${formatMoney(h.winner1.points)} pts)\n`;
        if (h.winner2) text += `🥈 ${h.winner2.username} (${formatMoney(h.winner2.points)} pts)\n`;
        if (h.winner3) text += `🥉 ${h.winner3.username} (${formatMoney(h.winner3.points)} pts)\n`;
        text += `👥 ${h.totalPlayers} pemain\n\n`;
    }
    reply(text);
    break;
}

        case "resetseason": {
    if (!botAdmins.includes(senderNumber)) return reply('⚠️ Hanya admin!');
    reply('⏳ Memproses reset season...');
    await doSeasonReset(reply);
    break;
}

        case "setseason": {
    if (!botAdmins.includes(senderNumber)) return reply('⚠️ Hanya admin!');
    if (!args[0]) return reply('⚙️ Format: .setseason <hari>\nContoh: .setseason 30');
    const days = parseInt(args[0]);
    if (isNaN(days) || days < 1) return reply('❌ Jumlah hari tidak valid!');
    currentSeason.endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    reply(`✅ Season diset berakhir dalam *${days} hari*.\nTanggal berakhir: *${currentSeason.endDate.toLocaleDateString('id-ID')}*`);
    break;
}

// ════════════════════════════════════════════════════════════
//   PRESTIGE SYSTEM
// ════════════════════════════════════════════════════════════
        case "prestige": {
    const user = await getOrCreateUser(senderNumber);
    const curLevel = user.prestige || 0;
    const nextReq  = PRESTIGE_REQUIREMENTS[curLevel];

    // .prestige confirm
    if (args[0] === 'confirm') {
        if (!nextReq) return reply('❌ Kamu sudah prestige maksimal!');
        if ((user.fishCaught || 0) < nextReq.fish)
            return reply(`❌ Belum cukup! Mancing dulu ${nextReq.fish - (user.fishCaught||0)} kali lagi.`);
        if ((user.money || 0) < nextReq.money)
            return reply(`❌ Uang kurang! Butuh *${formatMoney(nextReq.money - (user.money||0))}* lagi.`);
        user.money -= nextReq.money;
        user.prestige = curLevel + 1;
        user.prestigeTokens = (user.prestigeTokens || 0) + 100;
        user.title = PRESTIGE_TITLES[user.prestige] || `Prestige ${user.prestige}`;
        if (!user.fishingRods.get('prestigerod')) {
            user.fishingRods.set('prestigerod', { ...fishingRod.prestigerod });
            user.markModified('fishingRods');
        }
        if (user.prestige >= 3 && !user.fishingRods.get('cosmicrod')) {
            user.fishingRods.set('cosmicrod', { ...fishingRod.cosmicrod });
            user.markModified('fishingRods');
        }
        if (user.prestige >= 5 && !user.fishingRods.get('eternityrod')) {
            user.fishingRods.set('eternityrod', { ...fishingRod.eternityrod });
            user.markModified('fishingRods');
        }
        await user.save();
        return reply(
            `🎉 *PRESTIGE ${user.prestige} UNLOCKED!*\n\n` +
            `🎖️ Title baru: *${user.title}*\n` +
            `🪙 +100 Prestige Tokens!\n` +
            `🎁 ${nextReq.reward}\n\n` +
            `💡 Gunakan *.tokenstore* untuk belanja tokens.`
        );
    }

    // .prestige info
    if (!nextReq) {
        return reply(
            `👑 *Prestige Level ${curLevel}* — Kamu sudah mencapai level tertinggi!\n\n` +
            `🎖️ Title: *${user.title || PRESTIGE_TITLES[curLevel]}*\n` +
            `🪙 Tokens: *${user.prestigeTokens || 0}*\n\n` +
            `💡 Gunakan *.tokenstore* untuk belanja tokens.`
        );
    }

    let text = `👑 *Sistem Prestige*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🎖️ Level kamu: *Prestige ${curLevel}*\n`;
    text += `🪙 Tokens: *${user.prestigeTokens || 0}*\n\n`;
    text += `⬆️ *Syarat Prestige ${curLevel + 1}:*\n`;
    text += `🐟 Total mancing: *${user.fishCaught || 0}/${nextReq.fish}*\n`;
    text += `💰 Uang: *${formatMoney(user.money || 0)}/${formatMoney(nextReq.money)}*\n\n`;
    text += `🎁 Hadiah: ${nextReq.reward}\n\n`;
    const canPrestige = (user.fishCaught || 0) >= nextReq.fish && (user.money || 0) >= nextReq.money;
    text += canPrestige
        ? `✅ *Kamu SUDAH memenuhi syarat!*\nKetik *.prestige confirm* untuk naik level.`
        : `❌ Belum memenuhi syarat.`;
    reply(text);
    break;
}



// ════════════════════════════════════════════════════════════
//   DAILY REWARD
// ════════════════════════════════════════════════════════════
        case "daily": {
    const user = await getOrCreateUser(senderNumber);
    const now = new Date();
    const last = user.lastDaily ? new Date(user.lastDaily) : null;

    if (last) {
        const diffH = (now - last) / (1000 * 60 * 60);
        if (diffH < 20) {
            const nextTime = new Date(last.getTime() + 20 * 60 * 60 * 1000);
            const waitH = Math.floor((nextTime - now) / (1000 * 60 * 60));
            const waitM = Math.floor(((nextTime - now) % (1000 * 60 * 60)) / (1000 * 60));
            return reply(`⏳ Daily reward sudah diambil!\nBisa ambil lagi dalam *${waitH}j ${waitM}m*.\n\n🔥 Streak: *${user.dailyStreak || 1}* hari`);
        }
        const diffD = (now - last) / (1000 * 60 * 60 * 24);
        if (diffD > 2) {
            user.dailyStreak = 0;
        }
    }

    user.dailyStreak = (user.dailyStreak || 0) + 1;
    user.lastDaily = now;

    // Cari reward berdasarkan streak
    const streakDay = user.dailyStreak;
    let reward = DAILY_REWARDS[0];
    for (const r of [...DAILY_REWARDS].reverse()) {
        if (streakDay >= r.streak) { reward = r; break; }
    }

    // Bonus event
    const eventMult = ACTIVE_EVENT.active ? ACTIVE_EVENT.multiplier : 1;
    const finalMoney = Math.floor(reward.money * eventMult);

    user.money = (user.money || 0) + finalMoney;
    user.gachaTickets = (user.gachaTickets || 0) + reward.tickets;
    await user.save();

    let text = `🎁 *Daily Reward!*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `${reward.desc}\n\n`;
    text += `💰 +${formatMoney(finalMoney)} coins\n`;
    if (reward.tickets > 0) text += `🎟️ +${reward.tickets} tiket gacha!\n`;
    if (eventMult > 1) text += `🔥 *Event Bonus x${eventMult}* aktif!\n`;
    text += `\n🔥 Streak: *${streakDay} hari*\n`;
    text += `💰 Saldo: *${formatMoney(user.money)}*\n`;
    text += `🎟️ Tiket gacha: *${user.gachaTickets}*`;
    reply(text);
    break;
}

// ════════════════════════════════════════════════════════════
//   UPGRADE STATS
// ════════════════════════════════════════════════════════════
        case "upgrade": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0]) {
        let text = `⬆️ *Upgrade Stats*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💰 Saldo: *${formatMoney(user.money)}*\n\n`;

        for (const [key, upg] of Object.entries(UPGRADES)) {
            const curLv = user[key + 'Upgrade'] || 0;
            const nextCost = curLv < upg.maxLevel ? formatMoney(upg.getCost(curLv)) : 'MAX';
            text += `${upg.name}\n`;
            text += `  Level: *${curLv}/${upg.maxLevel}* | Efek: +${(upg.effect(curLv)*100).toFixed(0)}%\n`;
            text += `  Biaya naik: *${nextCost}*\n`;
            text += `  Ketik *.upgrade ${key}*\n\n`;
        }
        return reply(text);
    }

    const upKey = args[0].toLowerCase();
    const upg = UPGRADES[upKey];
    if (!upg) return reply(`❌ Upgrade tidak ada.\nPilih: ${Object.keys(UPGRADES).join(', ')}`);

    const curLv = user[upKey + 'Upgrade'] || 0;
    if (curLv >= upg.maxLevel) return reply(`✅ *${upg.name}* sudah MAX Level ${upg.maxLevel}!`);

    const cost = upg.getCost(curLv);
    if ((user.money || 0) < cost) return reply(`💸 Uang kurang!\nButuh: *${formatMoney(cost)}*\nPunya: *${formatMoney(user.money)}*`);

    user.money -= cost;
    user[upKey + 'Upgrade'] = curLv + 1;
    await user.save();

    reply(
        `✅ *${upg.name}* naik ke Level *${curLv + 1}*!\n\n` +
        `💸 Biaya: ${formatMoney(cost)}\n` +
        `📊 Efek total: +${(upg.effect(curLv + 1)*100).toFixed(0)}%\n` +
        `💰 Saldo: ${formatMoney(user.money)}`
    );
    break;
}

// ════════════════════════════════════════════════════════════
//   GACHA SYSTEM
// ════════════════════════════════════════════════════════════
        case "gacha": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0]) {
        return reply(
            `🎰 *Gacha Fisch*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🎟️ Tiket kamu: *${user.gachaTickets || 0}*\n` +
            `🔄 Pity: *${user.gachaPity || 0}/${GACHA_PITY_LIMIT}* (SSR guaranteed)\n\n` +
            `*Cara pull:*\n` +
            `• *.gacha pull* — 1x pull pakai tiket\n` +
            `• *.gacha coins* — 1x pull pakai ${formatMoney(GACHA_COST_COINS)} coins\n` +
            `• *.gacha multi* — 10x pull tiket (hemat!)\n\n` +
            `*Pool Hadiah:*\n` +
            `⚪ Common 55%: Enchant Scroll, Tiket, XP Boost\n` +
            `🟢 Rare 25%: Rod, Enchant Scroll, Bait, Tiket\n` +
            `🔵 Epic 13%: Rod, Enchant Scroll, Token, Bait\n` +
            `🟡 Legendary 6%: Rod (Midas/Avalanche), Token\n` +
            `⭐ SSR 1%: Void Rod / Cosmic Rod / 200 Token\n` +
            `🔄 Pity ${GACHA_PITY_LIMIT}x: SSR guaranteed!`
        );
    }

    const mode = args[0].toLowerCase();
    const pulls = mode === 'multi' ? 10 : 1;

    if (mode === 'coins') {
        if ((user.money || 0) < GACHA_COST_COINS) return reply(`💸 Butuh *${formatMoney(GACHA_COST_COINS)}* coins.`);
        user.money -= GACHA_COST_COINS;
    } else {
        if ((user.gachaTickets || 0) < pulls) return reply(`🎟️ Butuh *${pulls}* tiket. Kamu punya *${user.gachaTickets || 0}*.`);
        user.gachaTickets -= pulls;
    }

    const results = [];
    for (let i = 0; i < pulls; i++) {
        const { item, isSSR, pity } = doGachaPull(user);
        results.push({ item, isSSR, pity });

        // Apply item berdasarkan tipe
        switch (item.type) {
            case 'coins':
                user.money = (user.money || 0) + item.value;
                break;
            case 'tickets':
                user.gachaTickets = (user.gachaTickets || 0) + item.value;
                break;
            case 'tokens':
                user.prestigeTokens = (user.prestigeTokens || 0) + item.value;
                break;
            case 'rod':
                if (fishingRod[item.value] && !user.fishingRods.get(item.value)) {
                    user.fishingRods.set(item.value, { ...fishingRod[item.value] });
                    user.markModified('fishingRods');
                }
                break;
            case 'enchant_scroll': {
                // Simpan scroll ke inventory untuk dipakai nanti
                if (!Array.isArray(user.inventory)) user.inventory = [];
                user.inventory.push({
                    type: 'enchant_scroll',
                    rarity: item.value,
                    id: Math.floor(100000 + Math.random() * 900000).toString(),
                    label: item.label
                });
                break;
            }
            case 'xp_boost': {
                if (!user.activeBoosts) user.activeBoosts = {};
                user.activeBoosts.xpBoost = (user.activeBoosts.xpBoost || 1) * item.value;
                user.markModified('activeBoosts');
                break;
            }
            case 'bait': {
                if (!Array.isArray(user.inventory)) user.inventory = [];
                user.inventory.push({
                    type: 'bait',
                    id: item.value,
                    label: item.label,
                    itemId: Math.floor(100000 + Math.random() * 900000).toString()
                });
                break;
            }
        }
    }
    await user.save();

    const rarEmoji = { common:'⚪', rare:'🟢', epic:'🔵', legendary:'🟡', ssr:'⭐' };
    const rarLabel = { common:'Common', rare:'Rare', epic:'Epic', legendary:'Legendary', ssr:'SSR ✨' };
    let text = `🎰 *Hasil Gacha (${pulls}x pull)*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const { item, isSSR, pity } of results) {
        text += `${rarEmoji[item.rarity] || '⚪'} [${rarLabel[item.rarity] || item.rarity}] ${item.label}`;
        if (isSSR || pity) text += ` ← PITY!`;
        text += `\n`;
    }
    text += `\n─────────────────────\n`;
    text += `💰 Saldo: *${formatMoney(user.money)}*\n`;
    text += `🎟️ Tiket: *${user.gachaTickets || 0}*\n`;
    text += `🪙 Tokens: *${user.prestigeTokens || 0}*\n`;
    text += `🔄 Pity: *${user.gachaPity || 0}/${GACHA_PITY_LIMIT}* pull`;
    reply(text);
    break;
}

// ════════════════════════════════════════════════════════════
//   PRESTIGE TOKEN SHOP
// ════════════════════════════════════════════════════════════
        case "tokenstore":
        case "toko": {
    const user = await getOrCreateUser(senderNumber);

    if (!args[0]) {
        let text = `🪙 *Prestige Token Store*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `🪙 Tokens kamu: *${user.prestigeTokens || 0}*\n\n`;
        TOKEN_SHOP.forEach((item, i) => {
            text += `${i+1}. ${item.name} — *${item.cost} tokens*\n`;
        });
        text += `\nKetik *.tokenstore beli <nomor>*`;
        return reply(text);
    }

    if (args[0] === 'beli') {
        const idx = parseInt(args[1]) - 1;
        if (isNaN(idx) || idx < 0 || idx >= TOKEN_SHOP.length) return reply('❌ Nomor item tidak valid.');
        const item = TOKEN_SHOP[idx];
        if ((user.prestigeTokens || 0) < item.cost) return reply(`❌ Token kurang! Butuh *${item.cost}*, punya *${user.prestigeTokens || 0}*.`);
        user.prestigeTokens -= item.cost;

        if (item.type === 'rod') {
            if (user.fishingRods.get(item.value)) return reply(`⚠️ Kamu sudah punya *${item.name}*.`);
            user.fishingRods.set(item.value, { ...fishingRod[item.value] });
            user.markModified('fishingRods');
        } else if (item.type === 'tickets') {
            user.gachaTickets = (user.gachaTickets || 0) + item.value;
        } else if (item.type === 'coins') {
            user.money = (user.money || 0) + item.value;
        }
        await user.save();
        reply(`✅ Berhasil beli *${item.name}*!\n🪙 Sisa tokens: *${user.prestigeTokens}*`);
    }
    break;
}

// ════════════════════════════════════════════════════════════
//   WEATHER COMMAND
// ════════════════════════════════════════════════════════════
        case "cuaca":
        case "weather": {
    const w = CURRENT_WEATHER;
    const timeLeft = Math.max(0, w.expiresAt - Date.now());
    const mins = Math.floor(timeLeft / 60000);
    const secs = Math.floor((timeLeft % 60000) / 1000);

    let txt = `🌦️ *Cuaca Saat Ini*\n${'─'.repeat(28)}\n`;
    txt += `${w.name}\n`;
    txt += `📝 ${w.desc}\n\n`;
    txt += `📊 *Efek:*\n`;
    txt += `  🍀 Luck Mult: ×${(w.luckMult||1).toFixed(2)}\n`;
    txt += `  ⚡ Speed Mult: ×${(w.speedMult||1).toFixed(2)}\n`;
    if (w.mutationBonus) txt += `  🧬 Mutation Bonus: +${(w.mutationBonus*100).toFixed(1)}%\n`;
    if (Object.keys(w.rarityBoost||{}).length) {
        txt += `  📈 Rarity Boost: ` + Object.entries(w.rarityBoost).map(([r,v])=>`${r} ×${v}`).join(', ') + `\n`;
    }
    if (w.exclusive?.length) txt += `  🐟 Ikan Eksklusif: ${w.exclusive.join(', ')}\n`;
    txt += `\n⏳ Berganti dalam: *${mins}m ${secs}s*\n`;
    txt += `\n💡 Cuaca berganti otomatis tiap 2 jam`;
    reply(txt);
    break;
}

// ════════════════════════════════════════════════════════════
//   REEL MINIGAME — perfect catch timing
// ════════════════════════════════════════════════════════════
        case "reel": {
    const user = await getOrCreateUser(senderNumber);
    const pending = user.fishingPending.find(p => p.sender === senderNumber);

    if (!pending) return reply("❌ Kamu belum memancing. Kirim *.mancing* dulu!");

    const timing = checkReelTiming(senderNumber);
    const now = Date.now();

    if (timing === 'perfect') {
        // Tandai sebagai perfect catch — bonus di .view
        pending.perfectCatch = true;
        pending.perfectBonus = 1.5 + Math.random() * 1.0; // 1.5x - 2.5x bonus
        user.perfectCatches = (user.perfectCatches || 0) + 1;
        user.markModified('fishingPending');
        await user.save();

        return reply(
            `🎯 *PERFECT CATCH!*\n\n` +
            `Timing-mu sempurna! 🔥\n` +
            `✨ Bonus nilai ikan: *×${pending.perfectBonus.toFixed(1)}*\n\n` +
            `Kirim *.view* untuk ambil hasilnya!`
        );
    } else if (timing === 'too_early') {
        const w = REEL_WINDOWS.get(senderNumber);
        const waitLeft = w ? ((w.windowStart - now) / 1000).toFixed(1) : '?';
        return reply(
            `⏳ *Terlalu Cepat!*\n\n` +
            `Ikan belum menggigit kencang...\n` +
            `Tunggu sekitar *${waitLeft} detik* lagi lalu kirim *.reel*!`
        );
    } else if (timing === 'too_late') {
        // Miss window — bisa tetap view tapi tanpa bonus
        return reply(
            `😅 *Kelewatan!*\n\n` +
            `Kamu terlambat menarik pancingan!\n` +
            `Ikan kabur dari bonus, tapi kamu masih bisa *.view* untuk ambil ikan biasa.`
        );
    } else {
        // no_session (ikan sudah diambil atau belum mancing)
        if (now >= pending.readyAt) {
            return reply(`🐟 Ikan sudah siap! Kirim *.view* untuk mengambil.`);
        }
        const remaining = ((pending.readyAt - now)/1000).toFixed(0);
        return reply(`🎣 Masih memancing... tunggu *${remaining}* detik lagi sebelum *.reel*!`);
    }
}

// ════════════════════════════════════════════════════════════
//   ACHIEVEMENT COMMAND
// ════════════════════════════════════════════════════════════
        case "achievement":
        case "ach": {
    const user = await getOrCreateUser(senderNumber);
    const earned = new Set(user.achievements || []);
    const total  = Object.keys(ACHIEVEMENTS).length;
    const pts    = user.achievementPoints || 0;

    if (args[0] === 'list' || args[0] === 'all') {
        const CATS = {
            '🎣 Memancing':  ['first_fish','fish_10','fish_50','fish_100','fish_500','fish_1000','fish_5000'],
            '💎 Rarity':     ['first_rare','first_epic','first_legendary','first_mythic','first_godly','first_secret','first_extinct'],
            '🧬 Mutasi':     ['first_mutation','rare_fish_10','mutation_10'],
            '💰 Kekayaan':   ['money_1m','money_1b','money_1t','sell_100m'],
            '🎣 Rod':        ['rod_level5','rod_level20','enchant_first','own_3rods','own_7rods'],
            '🏝️ Eksplorasi': ['visit_3islands','visit_all'],
            '⭐ Spesial':    ['big_fish','perfect_10','storm_fisher','night_catcher'],
        };
        let txt = `🏆 *Daftar Achievement*\n${'─'.repeat(28)}\n`;
        txt += `📊 Progress: *${earned.size}/${total}* | Poin: *${pts}*\n\n`;
        for (const [cat, ids] of Object.entries(CATS)) {
            txt += `*${cat}*\n`;
            for (const id of ids) {
                const ach = ACHIEVEMENTS[id];
                if (!ach) continue;
                const done = earned.has(id);
                txt += `  ${done ? '✅' : '⬜'} ${ach.name} _(${ach.pts} pts)_\n`;
            }
            txt += '\n';
        }
        return reply(txt);
    }

    // Default: ringkasan
    const recentEarned = (user.achievements || []).slice(-5).map(id => ACHIEVEMENTS[id]?.name || id);
    let txt = `🏆 *Achievement ${user.username}*\n${'─'.repeat(28)}\n`;
    txt += `📊 Progress: *${earned.size}/${total}* achievement\n`;
    txt += `⭐ Poin: *${pts}*\n\n`;
    if (recentEarned.length) {
        txt += `🕐 *Terbaru:*\n`;
        txt += recentEarned.reverse().map(n=>`  • ${n}`).join('\n') + '\n\n';
    }
    txt += `💡 *.ach list* untuk lihat semua`;
    reply(txt);
    break;
}

// ════════════════════════════════════════════════════════════
//   STREAK COMMAND
// ════════════════════════════════════════════════════════════
        case "streak": {
    const streak = FISHING_STREAKS.get(senderNumber) || 0;
    const bon = getStreakBonus(streak);
    let txt = `🔥 *Fishing Streak*\n${'─'.repeat(28)}\n`;
    txt += `Streak saat ini: *${streak}x*\n`;
    if (streak >= 3) {
        txt += `💰 Sell Bonus: *×${bon.mult.toFixed(2)}*\n`;
        if (bon.luckAdd) txt += `🍀 Luck Bonus: *+${(bon.luckAdd*100).toFixed(0)}%*\n`;
        if (bon.mutAdd)  txt += `🧬 Mutation Bonus: *+${(bon.mutAdd*100).toFixed(0)}%*\n`;
    }
    txt += '\n*Milestone Streak:*\n';
    for (const s of STREAK_BONUSES) {
        const done = streak >= s.streak;
        txt += `  ${done ? '🔥' : '⬜'} *${s.streak}x* — ${s.desc}\n`;
    }
    txt += `\n💡 Streak reset jika hasil tangkapan ada ikan common!`;
    reply(txt);
    break;
}

// ════════════════════════════════════════════════════════════
//   WORLD BOSS COMMAND
// ════════════════════════════════════════════════════════════
        case "boss": {
    if (!activeWorldBoss) {
        if (botAdmins.includes(senderNumber) && args[0] === 'spawn') {
            const bossId = args[1] || 'kraken_jr';
            const bossTemplate = WORLD_BOSSES.find(b => b.id === bossId);
            if (!bossTemplate) return reply(`❌ Boss tidak ditemukan. Pilih: ${WORLD_BOSSES.map(b=>b.id).join(', ')}`);
            activeWorldBoss = { ...bossTemplate, hp: bossTemplate.maxHp, contributors: {} };
            return reply(`⚔️ *WORLD BOSS MUNCUL!*\n\n${activeWorldBoss.name}\n${activeWorldBoss.desc}\n\nHP: ${formatMoney(activeWorldBoss.hp)}\n\n⚔️ Kirim *.boss attack* untuk menyerang!`);
        }
        return reply(
            `🌊 *Tidak ada World Boss aktif.*\n\n` +
            `World Boss muncul secara acak atau diaktifkan admin.\n` +
            `Boss yang tersedia:\n` + WORLD_BOSSES.map(b=>`  • ${b.name}: ${b.desc}`).join('\n')
        );
    }

    if (args[0] === 'attack' || args[0] === 'serang') {
        const user = await getOrCreateUser(senderNumber);
        // Cek cooldown attack (1 kali per 30 detik)
        const lastAtk = (user.islandCooldowns || {})['boss_attack'] || 0;
        const atkCd   = 30000;
        if (Date.now() - lastAtk < atkCd) {
            const w8 = Math.ceil((atkCd - (Date.now()-lastAtk))/1000);
            return reply(`⏳ Cooldown serangan: *${w8} detik* lagi.`);
        }
        if (!user.islandCooldowns) user.islandCooldowns = {};
        user.islandCooldowns['boss_attack'] = Date.now();
        user.markModified('islandCooldowns');
        await user.save();

        const result = await attackWorldBoss(user, client, from);
        if (!result) return reply("❌ Boss sudah pergi!");
        if (result.bossKilled) {
            reply(`💥 *BOSS DIKALAHKAN!* Pukulan terakhirmu: *${formatMoney(result.dmg)} dmg*\n🎁 Reward sedang dibagikan!`);
        } else {
            const hpPct = ((activeWorldBoss.hp / activeWorldBoss.maxHp)*100).toFixed(1);
            reply(
                `⚔️ *Menyerang ${activeWorldBoss.name}!*\n\n` +
                `💥 Damage: *${formatMoney(result.dmg)}*\n` +
                `❤️ HP Boss: *${formatMoney(activeWorldBoss.hp)}* / ${formatMoney(activeWorldBoss.maxHp)} (${hpPct}%)`
            );
        }
    } else {
        const hpPct = ((activeWorldBoss.hp / activeWorldBoss.maxHp)*100).toFixed(1);
        const topContrib = Object.entries(activeWorldBoss.contributors)
            .sort((a,b)=>b[1]-a[1]).slice(0,5)
            .map(([id,d],i)=>`  ${i+1}. Player ${id}: ${formatMoney(d)} dmg`).join('\n') || '  Belum ada';
        reply(
            `⚔️ *WORLD BOSS AKTIF!*\n${'─'.repeat(28)}\n` +
            `👹 ${activeWorldBoss.name}\n` +
            `📝 ${activeWorldBoss.desc}\n\n` +
            `❤️ HP: *${formatMoney(activeWorldBoss.hp)}* / ${formatMoney(activeWorldBoss.maxHp)} (${hpPct}%)\n\n` +
            `🏆 *Top Kontributor:*\n${topContrib}\n\n` +
            `⚔️ Serang dengan *.boss attack*\n` +
            `🎁 Reward: ${formatMoney(activeWorldBoss.reward.money)} money + ${activeWorldBoss.reward.tokens} tokens + ${activeWorldBoss.reward.tickets} tiket`
        );
    }
    break;
}

// ════════════════════════════════════════════════════════════
//   SKIN SYSTEM COMMAND
// ════════════════════════════════════════════════════════════
        case "skin": {
    const user = await getOrCreateUser(senderNumber);
    const ownedSkins = user.ownedSkins || ['default'];
    if (!ownedSkins.includes('default')) ownedSkins.push('default');

    if (!args[0]) {
        let txt = `🎨 *Rod Skin Shop*\n${'─'.repeat(28)}\n`;
        txt += `Skin aktif: *${ROD_SKINS[user.equippedSkin || 'default']?.emoji} ${ROD_SKINS[user.equippedSkin || 'default']?.name}*\n\n`;
        for (const [key, skin] of Object.entries(ROD_SKINS)) {
            const owned = ownedSkins.includes(key);
            const active = (user.equippedSkin || 'default') === key;
            let costTxt = '';
            if (skin.price > 0)  costTxt = `💰 ${formatMoney(skin.price)}`;
            else if (skin.gacha) costTxt = '🎰 Gacha SSR';
            else if (skin.token) costTxt = `🪙 ${skin.token} tokens`;
            else if (skin.ach)   costTxt = `🏆 ${skin.ach} ach pts`;
            else                 costTxt = 'Gratis';
            txt += `${active ? '✅' : owned ? '🔓' : '🔒'} ${skin.emoji} *${skin.name}*\n`;
            txt += `   📝 ${skin.desc} | ${costTxt}\n`;
            if (!owned) txt += `   ↳ Beli: *.skin buy ${key}*\n`;
            else if (!active) txt += `   ↳ Pakai: *.skin equip ${key}*\n`;
        }
        return reply(txt);
    }

    if (args[0] === 'buy') {
        const skinKey = args[1];
        const skin = ROD_SKINS[skinKey];
        if (!skin) return reply(`❌ Skin "${skinKey}" tidak ditemukan!`);
        if (ownedSkins.includes(skinKey)) return reply(`✅ Kamu sudah punya skin *${skin.name}*!`);
        if (!skin.price || skin.price <= 0) return reply(`❌ Skin ini tidak bisa dibeli langsung.\n${skin.gacha?'Dapatkan dari gacha!':skin.token?`Tukar di token store!`:''}`);
        if ((user.money||0) < skin.price) return reply(`💸 Uang tidak cukup! Perlu: ${formatMoney(skin.price)}, Punya: ${formatMoney(user.money)}`);
        user.money -= skin.price;
        user.ownedSkins = [...ownedSkins, skinKey];
        await user.save();
        return reply(`✅ Berhasil beli skin *${skin.emoji} ${skin.name}*!\nKetik *.skin equip ${skinKey}* untuk memakainya.`);
    }

    if (args[0] === 'equip') {
        const skinKey = args[1];
        const skin = ROD_SKINS[skinKey];
        if (!skin) return reply(`❌ Skin "${skinKey}" tidak ditemukan!`);
        if (!ownedSkins.includes(skinKey)) return reply(`❌ Kamu belum punya skin ini. Beli dulu!`);
        user.equippedSkin = skinKey;
        await user.save();
        return reply(`✅ Skin *${skin.emoji} ${skin.name}* sekarang aktif!`);
    }
    reply(`💡 Cara pakai: *.skin* (lihat toko) | *.skin buy <nama>* | *.skin equip <nama>*`);
    break;
}

// ════════════════════════════════════════════════════════════
//   BIGGESTFISH COMMAND
// ════════════════════════════════════════════════════════════
        case "biggestfish":
        case "bigfish": {
    const user = await getOrCreateUser(senderNumber);
    if (!user.biggestFish) return reply("🐟 Kamu belum pernah menangkap ikan! Coba *.mancing* dulu.");
    const bf = user.biggestFish;
    const date = bf.date ? new Date(bf.date).toLocaleDateString('id-ID') : '?';
    reply(
        `🐳 *Ikan Terbesar ${user.username}*\n${'─'.repeat(28)}\n\n` +
        `🐟 Nama: *${bf.name}*\n` +
        `⚖️ Berat: *${bf.kg} kg*\n` +
        `💰 Nilai: *${formatMoney(bf.price)}*\n` +
        `📅 Ditangkap: ${date}\n\n` +
        `💡 Tangkap ikan lebih berat untuk memecahkan rekor!`
    );
    break;
}

// ════════════════════════════════════════════════════════════
//   EVENT SYSTEM (Admin)
// ════════════════════════════════════════════════════════════
        case "event": {
    if (!args[0]) {
        if (!ACTIVE_EVENT.active) {
            return reply(`📅 *Tidak ada event aktif saat ini.*\n\n💡 Admin: *.event start <nama> <durasi_jam> <multiplier>*`);
        }
        const timeLeft = new Date(ACTIVE_EVENT.endTime) - Date.now();
        const h = Math.floor(timeLeft / 3600000);
        const m = Math.floor((timeLeft % 3600000) / 60000);
        return reply(
            `🎪 *EVENT AKTIF: ${ACTIVE_EVENT.name}*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📜 ${ACTIVE_EVENT.desc}\n` +
            `💰 Bonus uang: *x${ACTIVE_EVENT.multiplier}*\n` +
            `🧬 Bonus mutasi: *+${(ACTIVE_EVENT.bonusMutation*100).toFixed(1)}%*\n` +
            `⏳ Berakhir dalam: *${h}j ${m}m*`
        );
    }
    if (!botAdmins.includes(senderNumber)) return reply('⚠️ Hanya admin!');

    if (args[0] === 'start') {
        const name = args[1] || 'Bonus Event';
        const hours = parseFloat(args[2]) || 24;
        const mult  = parseFloat(args[3]) || 2;
        ACTIVE_EVENT = {
            active: true,
            name,
            desc: `Event spesial selama ${hours} jam!`,
            multiplier: mult,
            bonusMutation: 0.05,
            endTime: new Date(Date.now() + hours * 3600000),
        };
        setTimeout(() => { ACTIVE_EVENT.active = false; console.log('[EVENT] ended'); }, hours * 3600000);
        reply(`✅ Event *${name}* dimulai!\n⏳ Durasi: ${hours} jam\n💰 Bonus: x${mult}`);
    } else if (args[0] === 'stop') {
        ACTIVE_EVENT.active = false;
        reply('✅ Event dihentikan.');
    }
    break;
}

// ════════════════════════════════════════════════════════════
//   BUANG UANG / SINK
// ════════════════════════════════════════════════════════════
        case "jackpot": {
    const user = await getOrCreateUser(senderNumber);
    if (!args[0]) {
        return reply(
            `🎲 *Jackpot Gamble*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Taruhan uangmu! Kemungkinan menang *40%*.\n` +
            `Menang: dapat *2.5x*\n` +
            `Kalah: kehilangan uang yang ditaruh\n\n` +
            `Format: *.jackpot <jumlah>*\nContoh: *.jackpot 1B*`
        );
    }
    const bet = parseAmount(args[0]);
    if (isNaN(bet) || bet <= 0) return reply('❌ Jumlah taruhan tidak valid!');
    if (bet > (user.money || 0)) return reply(`💸 Uang tidak cukup! Punya: *${formatMoney(user.money)}*`);
    const minBet = 1000000;
    if (bet < minBet) return reply(`❌ Taruhan minimum *${formatMoney(minBet)}*.`);

    const win = Math.random() < 0.40;
    if (win) {
        const gain = Math.floor(bet * 2.5);
        user.money = (user.money || 0) - bet + gain;
        await user.save();
        reply(`🎲 *MENANG!* 🎉\n\n💰 Taruhan: ${formatMoney(bet)}\n💵 Dapat: *+${formatMoney(gain)}*\n💰 Saldo: *${formatMoney(user.money)}*`);
    } else {
        user.money = (user.money || 0) - bet;
        await user.save();
        reply(`🎲 *KALAH!*\n\n💰 Taruhan: ${formatMoney(bet)}\n💸 Hilang: *-${formatMoney(bet)}*\n💰 Saldo: *${formatMoney(user.money)}*`);
    }
    break;
}

        case "donate": {
    // Sink uang ke season prize pool atau "dewa laut"
    const user = await getOrCreateUser(senderNumber);
    if (!args[0]) return reply(`💝 *Donasi ke Dewa Laut*\n\nKorbankan uangmu untuk mendapat EXP & Season Points!\nSetiap 1M yang didonasikan = 100 Season Points.\n\nFormat: *.donate <jumlah>*`);
    const amount = parseAmount(args[0]);
    if (isNaN(amount) || amount <= 0) return reply('❌ Jumlah tidak valid!');
    if (amount > (user.money || 0)) return reply('💸 Uang tidak cukup!');
    const pts = Math.floor(amount / 1000000) * 100;
    user.money -= amount;
    user.seasonPoints = (user.seasonPoints || 0) + pts;
    await user.save();
    reply(`💝 Donasi *${formatMoney(amount)}* ke Dewa Laut!\n\n🏆 +${formatMoney(pts)} Season Points\n💰 Saldo: *${formatMoney(user.money)}*`);
    break;
}

        case "rodupgrade": {
    // Sink coins besar untuk upgrade rod aktif permanen
    const user = await getOrCreateUser(senderNumber);
    const rodKey = user.usedFishingRod;
    const rod = user.fishingRods.get(rodKey);
    if (!rod) return reply('⚠️ Tidak ada rod aktif!');

    const upgCost = Math.floor(1e12 * Math.pow(1.5, rod.enchantCount || 0));
    if (!args[0]) {
        return reply(
            `🔧 *Rod Upgrade Permanen*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🎣 Rod: *${rod.name}*\n` +
            `📊 Stats saat ini:\n` +
            `  🍀 Luck: ${((rod.luck||0)*100).toFixed(1)}%\n` +
            `  ⚡ Speed: ${((rod.speed||0)*100).toFixed(1)}%\n` +
            `  💰 Sell: x${(1+(rod.sellMultiplier||0)).toFixed(2)}\n\n` +
            `💸 Biaya upgrade: *${formatMoney(upgCost)}*\n` +
            `📈 Efek: Luck +5%, Speed +2%, Sell +10%\n\n` +
            `Ketik *.rodupgrade confirm* untuk upgrade.`
        );
    }
    if (!args[0] || args[0] !== 'confirm') break;
    if ((user.money || 0) < upgCost) return reply(`💸 Butuh *${formatMoney(upgCost)}*. Punya *${formatMoney(user.money)}*.`);
    user.money -= upgCost;
    rod.luck = (rod.luck || 0) + 0.05;
    rod.speed = Math.min((rod.speed || 0) + 0.02, 0.99);
    rod.sellMultiplier = (rod.sellMultiplier || 0) + 0.10;
    rod.enchantCount = (rod.enchantCount || 0) + 1;
    user.fishingRods.set(rodKey, rod);
    user.markModified('fishingRods');
    await user.save();
    reply(
        `✅ *Rod Upgraded!*\n\n` +
        `🎣 ${rod.name}\n` +
        `🍀 Luck: +5%\n⚡ Speed: +2%\n💰 Sell: +10%\n` +
        `💸 Biaya: ${formatMoney(upgCost)}\n` +
        `💰 Saldo: ${formatMoney(user.money)}`
    );
    break;
}

        case "stats": {
    // Lihat upgrade stats
    const user = await getOrCreateUser(senderNumber);
    const rod  = user.fishingRods.get(user.usedFishingRod);
    const { luck, speed, sellMultiplier } = getUpgradedStats(user, rod || {});
    let text = `📊 *Stats ${user.username}*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🎖️ Title: *${user.title || 'Pemancing Baru'}*\n`;
    text += `👑 Prestige: *${user.prestige || 0}*\n`;
    text += `🪙 Tokens: *${user.prestigeTokens || 0}*\n`;
    text += `🎟️ Tiket Gacha: *${user.gachaTickets || 0}*\n`;
    text += `🔥 Daily Streak: *${user.dailyStreak || 0}*\n\n`;
    text += `📈 *Upgrade Permanen:*\n`;
    text += `  🍀 Luck: +${((UPGRADES.luck.effect(user.luckUpgrade||0))*100).toFixed(0)}% (Lv.${user.luckUpgrade||0})\n`;
    text += `  ⚡ Speed: +${((UPGRADES.speed.effect(user.speedUpgrade||0))*100).toFixed(0)}% (Lv.${user.speedUpgrade||0})\n`;
    text += `  💰 Sell: +${((UPGRADES.sell.effect(user.sellUpgrade||0))*100).toFixed(0)}% (Lv.${user.sellUpgrade||0})\n\n`;
    text += `🎣 *Total Stats (rod+upgrade):*\n`;
    text += `  🍀 Luck: ${(luck*100).toFixed(1)}%\n`;
    text += `  ⚡ Speed: ${(speed*100).toFixed(1)}%\n`;
    text += `  💰 Sell: x${(1+sellMultiplier).toFixed(2)}\n\n`;
    text += `🏆 *Season:*\n`;
    text += `  🏅 Poin: *${formatMoney(user.seasonPoints || 0)}*\n`;
    text += `  🏆 Season Wins: *${user.seasonWins || 0}*`;
    reply(text);
    break;
}

            default: {
                // ── Dev-only: eval JS (=>), exec shell ($) ──────────
                if (!botAdmins.includes(senderNumber)) break;

                if (budy.startsWith('=>')) {
                    async function Return(sul) {
                        const sat = JSON.stringify(sul, null, 2);
                        const bang = (!sat || sat === 'undefined') ? util.format(sul) : util.format(sat);
                        return await m.reply(bang);
                    }
                    try {
                        await m.reply(util.format(await eval(`(async () => { return ${budy.slice(3)} })()`)));
                    } catch (e) { await m.reply(String(e)); }

                } else if (budy.startsWith('>')) {
                    let teks;
                    try {
                        teks = await eval(`(async () => { ${budy.startsWith('>>') ? 'return' : ''} ${q} })()`);
                    } catch (e) {
                        teks = e;
                    }
                    await m.reply(require('util').format(teks));

                } else if (budy.startsWith('$')) {
                    exec(budy.slice(2), (err, stdout) => {
                        if (err)    return m.reply(String(err).slice(0, 3000)).catch(() => {});
                        if (stdout) return m.reply(stdout.slice(0, 3000)).catch(() => {});
                    });
                }
                break;
            }

        } // end switch

    } catch (err) {
        const errStr = require('util').format(err);
        const IGNORE_ERRORS = [
            'SessionError', 'No sessions', 'session_cipher', 'Bad MAC',
            'decryptSenderKey', 'Message decryption failed', 'EKEYTYPE',
            'item-not-found', 'rate-overlimit', 'Connection Closed', 'Timed Out',
            'buffer underflow', 'Invalid PreKey', 'No SenderKeyRecord',
            'not-acceptable', 'not-authorized', 'assertSessions',
            'stream errored', 'Receiving end does not exist'
        ];
        if (IGNORE_ERRORS.some(e => errStr.includes(e))) return;
        console.error('[message.js]', errStr.slice(0, 500));
        for (const admin of botAdmins) {
            try { await client.sendMessage(`${admin}@s.whatsapp.net`, { text: `⚠️ Error:\n${errStr.slice(0, 800)}` }); } catch (_) {}
        }
    }
};

// ── Hot-reload (hanya aktif saat NODE_ENV=development) ──
if (process.env.NODE_ENV === 'development') {
    let _msgFile = require.resolve(__filename);
    require('fs').watchFile(_msgFile, { interval: 2000, persistent: false }, () => {
        require('fs').unwatchFile(_msgFile);
        console.log('[message.js] Hot-reload...');
        delete require.cache[_msgFile];
    });
}
