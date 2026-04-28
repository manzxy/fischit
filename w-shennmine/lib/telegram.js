'use strict';
/**
 * ═══════════════════════════════════════════════════
 *  FISCH BOT — TELEGRAM v3  (Full WA Parity)
 *  Commands: menu/help, daily, upgrade, gacha,
 *  tokenstore, prestige, jackpot, donate, rodupgrade,
 *  stats, listenchant, resetme, event, weather,
 *  reel, streak, achievement, boss, skin, biggestfish,
 *  mancing, view, sell(filter), inventory, fishbook,
 *  mutationbook, shop, buy, equip, listrod, enchant,
 *  travel, top, season, transfer, player, friends,
 *  tutorial, currency, me, money, rename
 * ═══════════════════════════════════════════════════
 */

const { Telegraf } = require('telegraf');
const crypto       = require('crypto');

// ── State ─────────────────────────────────────────────────
let bot       = null;
let Player_   = null;
let Session_  = null;
let isReady   = false;
let waClient_ = null;

// ── Format helpers ────────────────────────────────────────
const fmt = (n) => {
    const num = Number(n || 0);
    if (isNaN(num)) return '0';
    const sfx = ['','k','M','B','T','Qa','Qi','Sx','Sp'];
    let tier = Math.floor(Math.log10(Math.abs(num) || 1) / 3);
    if (tier >= sfx.length) tier = sfx.length - 1;
    if (tier < 1) return num.toLocaleString('id-ID');
    const scale = Math.pow(10, tier * 3);
    return (Math.round(num / scale * 100) / 100) + sfx[tier];
};

const parseAmount = (s) => {
    if (!s) return NaN;
    s = String(s).trim().toUpperCase();
    const map = { K:1e3, M:1e6, B:1e9, T:1e12, QA:1e15, QI:1e18 };
    for (const [suf, mul] of Object.entries(map)) {
        if (s.endsWith(suf)) return parseFloat(s) * mul;
    }
    return parseFloat(s);
};

const esc = (s) => String(s ?? '')
    .replace(/\\/g,'\\\\').replace(/\*/g,'\\*')
    .replace(/_/g,'\\_').replace(/`/g,'\\`')
    .replace(/\[/g,'\\[');

const genID = () => 'FC-' + crypto.randomBytes(4).toString('hex').toUpperCase();

const RE = { common:'⚪',uncommon:'🟢',rare:'💚',epic:'💙',legendary:'💛',mythic:'🟣',godly:'🌟',secret:'⚫',extinct:'🦕',special:'✨',exotic:'🟠',ssr:'⭐' };
const RARITY_ORDER = ['common','uncommon','rare','epic','legendary','mythic','godly','secret','extinct','special'];

// ── Safe reply ────────────────────────────────────────────
async function rep(ctx, text, extra = {}) {
    try {
        return await ctx.reply(text, { parse_mode: 'Markdown', disable_web_page_preview: true, ...extra });
    } catch {
        try { return await ctx.reply(text.replace(/[*_`\[\]\\]/g,''), { disable_web_page_preview: true }); }
        catch (e) { console.error('[TG rep]', e.message); }
    }
}

// ── needLink guard ────────────────────────────────────────
async function needLink(ctx) {
    if (!Player_) return null;
    try {
        const p = await Player_.findOne({ isVerifiedTelegram: true, telegramId: String(ctx.from.id) });
        if (!p) {
            await rep(ctx, '❌ *Akun belum terhubung!*\n\n*Cara link:*\n1\\. Chat bot WA → ketik `.linktele`\n2\\. Salin kode 6 digit\n3\\. Di sini: `/confirm KODE`');
            return null;
        }
        return p;
    } catch (e) {
        console.error('[TG needLink]', e.message);
        await rep(ctx, '❌ Database error. Coba lagi.');
        return null;
    }
}

// ── Shared constants (mirror dari WA message.js) ──────────
const UPGRADES = {
    luck:  { name:'🍀 Luck Upgrade',  maxLevel:50, effect:(lv)=>lv*0.02, getCost:(lv)=>Math.floor(5000000*Math.pow(2.5,lv))  },
    speed: { name:'⚡ Speed Upgrade', maxLevel:40, effect:(lv)=>lv*0.01, getCost:(lv)=>Math.floor(3000000*Math.pow(2.3,lv))  },
    sell:  { name:'💰 Sell Upgrade',  maxLevel:60, effect:(lv)=>lv*0.05, getCost:(lv)=>Math.floor(8000000*Math.pow(2.8,lv))  },
};

const DAILY_REWARDS = [
    { streak:1,  money:50000,       tickets:0,  desc:'Hari 1 🎣' },
    { streak:2,  money:100000,      tickets:0,  desc:'Hari 2 ✨' },
    { streak:3,  money:250000,      tickets:1,  desc:'Hari 3 🎟️ +1 tiket!' },
    { streak:4,  money:500000,      tickets:0,  desc:'Hari 4 💰' },
    { streak:5,  money:1000000,     tickets:2,  desc:'Hari 5 🎟️🎟️ +2 tiket!' },
    { streak:6,  money:2000000,     tickets:0,  desc:'Hari 6 🌟' },
    { streak:7,  money:10000000,    tickets:5,  desc:'Hari 7 🔥 BONUS BESAR! +5 tiket!' },
    { streak:14, money:100000000,   tickets:10, desc:'2 Minggu 💎 STREAK BONUS!' },
    { streak:30, money:1000000000,  tickets:20, desc:'1 Bulan 👑 LEGEND STREAK!' },
];

const GACHA_PITY  = 80;
const GACHA_COINS = 5000000;

const GACHA_POOL = [
    { type:'enchant_scroll', value:'common',      label:'📜 Enchant Scroll (Common)',       rarity:'common',    weight:22   },
    { type:'tickets',        value:2,             label:'🎟️ 2 Tiket Gacha',                rarity:'common',    weight:18   },
    { type:'xp_boost',       value:1.5,           label:'⚡ XP Boost ×1.5',                rarity:'common',    weight:15   },
    { type:'rod',            value:'luckyrod',    label:'🎣 Lucky Rod',                     rarity:'rare',      weight:10   },
    { type:'enchant_scroll', value:'rare',        label:'📜 Enchant Scroll (Rare)',          rarity:'rare',      weight:8    },
    { type:'tickets',        value:5,             label:'🎟️ 5 Tiket Gacha',                rarity:'rare',      weight:4    },
    { type:'bait',           value:'goldbait',    label:'🪱 Golden Bait (×2 luck)',          rarity:'rare',      weight:3    },
    { type:'rod',            value:'precisionrod',label:'🎣 Precision Rod',                  rarity:'epic',      weight:5    },
    { type:'enchant_scroll', value:'epic',        label:'📜 Enchant Scroll (Epic)',          rarity:'epic',      weight:4    },
    { type:'tokens',         value:25,            label:'🪙 25 Prestige Tokens',             rarity:'epic',      weight:3    },
    { type:'bait',           value:'crystalbait', label:'💎 Crystal Bait (×3 luck+sell)',    rarity:'epic',      weight:1    },
    { type:'rod',            value:'midasrod',    label:'🎣 Midas Rod',                      rarity:'legendary', weight:2.5  },
    { type:'tokens',         value:75,            label:'🪙 75 Prestige Tokens',             rarity:'legendary', weight:2.0  },
    { type:'rod',            value:'avalancherod',label:'🎣 Avalanche Rod',                  rarity:'legendary', weight:1.5  },
    { type:'rod',            value:'voidrod',     label:'🌑 Void Rod',                       rarity:'ssr',       weight:0.5  },
    { type:'rod',            value:'cosmicrod',   label:'🌌 Cosmic Rod',                     rarity:'ssr',       weight:0.3  },
    { type:'tokens',         value:200,           label:'🪙 200 Prestige Tokens',            rarity:'ssr',       weight:0.2  },
];

const TOKEN_SHOP = [
    { id:'ts_void',    name:'🌑 Void Rod',          cost:300, type:'rod',     value:'voidrod'         },
    { id:'ts_cosmic',  name:'🌌 Cosmic Rod',         cost:800, type:'rod',     value:'cosmicrod'       },
    { id:'ts_t10',     name:'🎟️ 10 Tiket Gacha',    cost:50,  type:'tickets', value:10                },
    { id:'ts_t50',     name:'🎟️ 50 Tiket Gacha',    cost:200, type:'tickets', value:50                },
    { id:'ts_100b',    name:'💰 100B Coins',          cost:100, type:'coins',   value:100_000_000_000   },
    { id:'ts_10t',     name:'💰 10T Coins',           cost:500, type:'coins',   value:10_000_000_000_000},
];

const PRESTIGE_REQ = [
    { fish:100,   money:50_000_000,       reward:'🎣 Prestige Rod + 100 Tokens' },
    { fish:300,   money:500_000_000,      reward:'🪙 +200 Tokens' },
    { fish:750,   money:5_000_000_000,    reward:'🌌 Cosmic Rod + 300 Tokens' },
    { fish:1500,  money:50_000_000_000,   reward:'🪙 +500 Tokens' },
    { fish:3000,  money:500_000_000_000,  reward:'🌟 Eternity Rod + 1000 Tokens' },
];
const PRESTIGE_TITLES = ['Pemancing Baru','Pemancing Handal','Master Pancing','Ahli Lautan','Raja Samudra','Dewa Laut'];

const FISH_CATALOG = {
    common:    [['Red Snapper',60],['Largemouth Bass',55],['Trout',50],['Bream',45],['Perch',40],['Catfish',65]],
    uncommon:  [['Carp',180],['Goldfish',200],['Clownfish',220],['Butterflyfish',250],['Minnow',160]],
    rare:      [['Snook',600],['Flounder',650],['Eel',700],['Blue Tang',750],['Ribbon Eel',800]],
    epic:      [['Pike',1500],['Whiptail Catfish',1600],['Yellow Boxfish',1800],['Clam',2000]],
    legendary: [['Squid',4000],['Angelfish',4500],['Arapaima',5000],['Alligator Gar',5500]],
    mythic:    [['Whisker Bill',10000],['Alligator',11000],['Diamond Swordfish',12000]],
    godly:     [['Handfish',25000],['Dumbo Octopus',28000],['Deep Pearl',30000]],
    secret:    [['Axolotl',70000],['Manta Ray',80000],['Golden Sea Pearl',90000]],
    extinct:   [['Megalodon Tooth',500000],['Trilobite King',600000],['Ancient Leviathan',800000]],
};

const MUTATIONS = [
    {key:'Normal',     mult:1.0,  chance:0.60},
    {key:'Albino',     mult:1.5,  chance:0.12},
    {key:'Gilded',     mult:2.0,  chance:0.08},
    {key:'Titanic',    mult:3.0,  chance:0.05},
    {key:'Shiny',      mult:4.0,  chance:0.04},
    {key:'Irradiated', mult:5.0,  chance:0.03},
    {key:'Crystalline',mult:6.0,  chance:0.02},
    {key:'Radioactive',mult:8.0,  chance:0.015},
    {key:'Abyssal',    mult:10.0, chance:0.010},
    {key:'Cosmic',     mult:15.0, chance:0.005},
    {key:'Void',       mult:25.0, chance:0.002},
    {key:'Divine',     mult:50.0, chance:0.0008},
];

const ROD_SHOP = {
    trainingrod:   {name:'Training Rod',    price:1200,           luck:0.01,speed:0.02,comboFish:1,sellMultiplier:0,    mutationsLuck:0.0005,level:1,maxLevel:10, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    plasticrod:    {name:'Plastic Rod',     price:15000,          luck:0.03,speed:0.04,comboFish:1,sellMultiplier:0.2,  mutationsLuck:0.001, level:1,maxLevel:20, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    ironrod:       {name:'Iron Rod',        price:25000,          luck:0.02,speed:0.03,comboFish:1,sellMultiplier:0.05, mutationsLuck:0.001, level:1,maxLevel:10, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    stonerod:      {name:'Stone Rod',       price:125000,         luck:0.07,speed:0.07,comboFish:1,sellMultiplier:0.3,  mutationsLuck:0.002, level:1,maxLevel:30, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    goldrod:       {name:'Gold Rod',        price:250000,         luck:0.06,speed:0.07,comboFish:1,sellMultiplier:0.15, mutationsLuck:0.003, level:1,maxLevel:15, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    fastrod:       {name:'Fast Rod',        price:2100000,        luck:0.12,speed:0.12,comboFish:1,sellMultiplier:0.9,  mutationsLuck:0.002, level:1,maxLevel:40, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    diamondrod:    {name:'Diamond Rod',     price:2500000,        luck:0.12,speed:0.13,comboFish:2,sellMultiplier:0.3,  mutationsLuck:0.007, level:1,maxLevel:20, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    carbonrod:     {name:'Carbon Rod',      price:6500000,        luck:0.18,speed:0.18,comboFish:1,sellMultiplier:1.2,  mutationsLuck:0.003, level:1,maxLevel:50, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    magmarod:      {name:'Magma Rod',       price:18000000,       luck:0.22,speed:0.20,comboFish:1,sellMultiplier:1.7,  mutationsLuck:0.0035,level:1,maxLevel:60, exp:0,expToNextLevel:600, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    luckyrod:      {name:'Lucky Rod',       price:32000000,       luck:0.28,speed:0.22,comboFish:1,sellMultiplier:1.8,  mutationsLuck:0.004, level:1,maxLevel:75, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    ancientrod:    {name:'Ancient Rod',     price:25000000,       luck:0.20,speed:0.20,comboFish:2,sellMultiplier:0.5,  mutationsLuck:0.015, level:1,maxLevel:25, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    fungalrod:     {name:'Fungal Rod',      price:45000000,       luck:0.25,speed:0.18,comboFish:1,sellMultiplier:2.2,  mutationsLuck:0.006, level:1,maxLevel:70, exp:0,expToNextLevel:900, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    steadyrod:     {name:'Steady Rod',      price:85000000,       luck:0.30,speed:0.24,comboFish:1,sellMultiplier:2.5,  mutationsLuck:0.004, level:1,maxLevel:80, exp:0,expToNextLevel:1000,enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    longrod:       {name:'Long Rod',        price:99000000,       luck:0.40,speed:0.28,comboFish:1,sellMultiplier:2.8,  mutationsLuck:0.003, level:1,maxLevel:100,exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    fortunerod:    {name:'Fortune Rod',     price:160000000,      luck:0.36,speed:0.26,comboFish:1,sellMultiplier:3.0,  mutationsLuck:0.007, level:1,maxLevel:90, exp:0,expToNextLevel:1500,enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    rapidrod:      {name:'Rapid Rod',       price:380000000,      luck:0.42,speed:0.34,comboFish:2,sellMultiplier:3.5,  mutationsLuck:0.008, level:1,maxLevel:95, exp:0,expToNextLevel:1800,enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    magnetrod:     {name:'Magnet Rod',      price:720000000,      luck:0.45,speed:0.30,comboFish:2,sellMultiplier:4.0,  mutationsLuck:0.01,  level:1,maxLevel:100,exp:0,expToNextLevel:2000,enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    mythicrod:     {name:'Mythic Rod',      price:250000000,      luck:0.30,speed:0.28,comboFish:3,sellMultiplier:0.75, mutationsLuck:0.025, level:1,maxLevel:30, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    legendaryrod:  {name:'Legendary Rod',   price:2500000000,     luck:0.42,speed:0.38,comboFish:3,sellMultiplier:1.0,  mutationsLuck:0.040, level:1,maxLevel:40, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    nocturnalrod:  {name:'Nocturnal Rod',   price:1500000000,     luck:0.50,speed:0.36,comboFish:2,sellMultiplier:4.6,  mutationsLuck:0.012, level:1,maxLevel:100,exp:0,expToNextLevel:2500,enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    precisionrod:  {name:'Precision Rod',   price:4200000000,     luck:0.60,speed:0.40,comboFish:2,sellMultiplier:5.2,  mutationsLuck:0.015, level:1,maxLevel:100,exp:0,expToNextLevel:3000,enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    depthseekerrod:{name:'Depthseeker Rod', price:25000000000,    luck:0.55,speed:0.48,comboFish:4,sellMultiplier:1.3,  mutationsLuck:0.060, level:1,maxLevel:50, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    voidrod:       {name:'Void Rod',        price:0,              luck:0.70,speed:0.60,comboFish:4,sellMultiplier:1.75, mutationsLuck:0.085, level:1,maxLevel:60, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    cosmicrod:     {name:'Cosmic Rod',      price:0,              luck:0.85,speed:0.72,comboFish:5,sellMultiplier:2.20, mutationsLuck:0.115, level:1,maxLevel:75, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    prestigerod:   {name:'Prestige Rod',    price:0,              luck:0.95,speed:0.80,comboFish:5,sellMultiplier:2.70, mutationsLuck:0.150, level:1,maxLevel:99, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
    eternityrod:   {name:'Eternity Rod',    price:0,              luck:1.50,speed:0.95,comboFish:7,sellMultiplier:5.00, mutationsLuck:0.280, level:1,maxLevel:99, exp:0,expToNextLevel:100, enchant:null,enchantCount:0,bonusStats:{},type:'rod'},
};

const ISLANDS = {
    mousewood:      {name:'Mousewood',       req:null},
    roslitbay:      {name:'Roslit Bay',      req:{money:5_000,       fish:5}},
    mushgroveswamp: {name:'Mushgrove Swamp', req:{money:25_000,      fish:20}},
    terrapinisland: {name:'Terrapin Island', req:{money:100_000,     fish:50}},
    theocean:       {name:'The Ocean',       req:{money:1_000_000,   fish:100}},
    atlantis:       {name:'Atlantis',        req:{money:10_000_000,  fish:200}},
    volcaniddepths: {name:'Volcani Depths',  req:{money:100_000_000, fish:400}},
    crystalcaves:   {name:'Crystal Caves',   req:{money:1_000_000_000,fish:750}},
};

const SKINS = {
    default:{name:'Default', emoji:'🎣', price:0},
    golden: {name:'Golden',  emoji:'🌟', price:5_000_000},
    neon:   {name:'Neon',    emoji:'💚', price:8_000_000},
    ocean:  {name:'Ocean',   emoji:'🌊', price:12_000_000},
    sakura: {name:'Sakura',  emoji:'🌸', price:15_000_000},
    dragon: {name:'Dragon',  emoji:'🐉', price:50_000_000},
    cosmic: {name:'Cosmic',  emoji:'🌌', price:0, gacha:true},
    void:   {name:'Void',    emoji:'🌑', price:0, token:100},
};

const ENCHANT_POOL = {
    common:    {w:40, list:['Swift','Hasty','Agile','Buoyant','Patient','Skilled']},
    rare:      {w:25, list:['Divine','Clever','Frostbite','Tempered']},
    epic:      {w:15, list:['Lucky','Volcanic','Deepcurrent','Mystical','Breezed','Tidal']},
    legendary: {w:10, list:['Royal Crest','Crystal Wave','Storming','Phantom','Tempest']},
    mythic:    {w:6,  list:['Chaotic','Wise','Immortal','Demonic','Astral','Tyrant']},
    godly:     {w:3,  list:["Abyssal Flare","Reaper's Net",'Radiant Core','Chaos Reign']},
    secret:    {w:1,  list:['Timeless','Voidheart','Godslayer','Universe','Abyss Core']},
};

// ── In-memory state ───────────────────────────────────────
const TG_STREAKS     = new Map(); // tgId -> streak count
const TG_REEL_WIN    = new Map(); // tgId -> {windowStart, windowEnd}
const TG_BOSS_CD     = new Map(); // tgId -> last attack ms
const TG_REEL_ACTIVE = new Map(); // tgId -> pending set

// ── Helper: generate fish ─────────────────────────────────
function generateFish(rod, island = 'mousewood') {
    const luck = Math.min((rod?.luck || 0), 1.5);
    const rarityW = [
        {r:'extinct',  w:0.01+luck*0.001},
        {r:'secret',   w:0.1 +luck*0.02},
        {r:'godly',    w:0.4 +luck*0.05},
        {r:'mythic',   w:0.8 +luck*0.08},
        {r:'legendary',w:2.0 +luck*0.15},
        {r:'epic',     w:5.0 +luck*0.30},
        {r:'rare',     w:12.0+luck*0.40},
        {r:'uncommon', w:Math.max(30.0-luck*0.20,5)},
        {r:'common',   w:Math.max(50.0-luck*0.50,5)},
    ];
    const totalW = rarityW.reduce((a,b)=>a+b.w,0);
    let roll = Math.random()*totalW, acc=0, rarity='common';
    for (const {r,w} of rarityW) { acc+=w; if(roll<=acc){rarity=r;break;} }

    const pool = FISH_CATALOG[rarity] || FISH_CATALOG.common;
    const [fishName, avgVal] = pool[Math.floor(Math.random()*pool.length)];
    const isGiant = Math.random() < 0.04;
    const baseKg  = 0.5 + Math.random() * (rarity==='extinct'?100000:rarity==='secret'?5000:rarity==='godly'?500:rarity==='mythic'?100:rarity==='legendary'?50:rarity==='epic'?30:20);
    const kg      = parseFloat((isGiant ? baseKg*(1.8+Math.random()*3) : baseKg).toFixed(2));

    let mutRoll=Math.random(), mutAcc=0, mutation='Normal';
    const mutBonus = rod?.mutationsLuck || 0;
    for (const m of MUTATIONS) {
        mutAcc += m.chance + mutBonus*m.chance;
        if (mutRoll<=mutAcc) { mutation=m.key; break; }
    }
    const mutMult  = MUTATIONS.find(m=>m.key===mutation)?.mult || 1;
    const sellMult = 1 + (rod?.sellMultiplier || 0);
    const price    = Math.round(avgVal * kg * mutMult * sellMult);

    return {
        name:(isGiant?'🔴 ':'')+fishName, rarity, kg, price,
        pricePerKg:avgVal, type:'fish',
        id:crypto.randomBytes(4).toString('hex'),
        mutations:[mutation], isMutated:mutation!=='Normal', island,
    };
}

// ── Helper: do gacha pull ─────────────────────────────────
function doPull(user) {
    user.gachaPity = (user.gachaPity||0) + 1;
    const isPity   = user.gachaPity >= GACHA_PITY;
    const ssrPool  = GACHA_POOL.filter(x=>x.rarity==='ssr');
    const normPool = GACHA_POOL.filter(x=>x.rarity!=='ssr');

    if (isPity) {
        user.gachaPity = 0;
        const item = ssrPool[Math.floor(Math.random()*ssrPool.length)];
        return { item, pity:true };
    }

    const totalW = GACHA_POOL.reduce((a,b)=>a+b.weight,0);
    let roll=Math.random()*totalW, acc=0;
    for (const item of GACHA_POOL) {
        acc += item.weight;
        if (roll<=acc) {
            if (item.rarity==='ssr') user.gachaPity=0;
            return { item, pity:false };
        }
    }
    return { item:GACHA_POOL[0], pity:false };
}

// ── Helper: apply gacha item ──────────────────────────────
function applyGachaItem(user, item) {
    switch (item.type) {
        case 'coins':         user.money           = (user.money||0)+item.value; break;
        case 'tickets':       user.gachaTickets    = (user.gachaTickets||0)+item.value; break;
        case 'tokens':        user.prestigeTokens  = (user.prestigeTokens||0)+item.value; break;
        case 'xp_boost':
            user.activeBoosts = user.activeBoosts||{};
            user.activeBoosts.xpBoost = (user.activeBoosts.xpBoost||1)*item.value;
            user.markModified('activeBoosts'); break;
        case 'rod':
            if (ROD_SHOP[item.value] && !user.fishingRods?.get?.(item.value)) {
                user.fishingRods = user.fishingRods || new Map();
                user.fishingRods.set(item.value, {...ROD_SHOP[item.value]});
                user.markModified('fishingRods');
            } break;
        case 'enchant_scroll':
        case 'bait':
            user.inventory = user.inventory||[];
            user.inventory.push({ type:item.type, rarity:item.value, id:crypto.randomBytes(4).toString('hex'), label:item.label, itemId:crypto.randomBytes(3).toString('hex') });
            break;
    }
}

// ── Helper: streak bonus ──────────────────────────────────
function streakMult(n) {
    return n>=100?3.0:n>=50?2.0:n>=20?1.5:n>=10?1.35:n>=5?1.2:n>=3?1.1:1.0;
}

// ═══════════════════════════════════════════════════════════
//   REGISTER ALL COMMANDS
// ═══════════════════════════════════════════════════════════
function registerAll(b) {

    // ── Logging middleware ────────────────────────────────
    b.use(async (ctx, next) => {
        if (ctx.message?.text) {
            const u = ctx.from?.username ? `@${ctx.from.username}` : `id:${ctx.from?.id}`;
            process.stdout.write(`\r\x1b[K`);
            console.log(`  \x1b[36m[TG]\x1b[0m 📨 \x1b[90m${u}\x1b[0m → \x1b[97m${ctx.message.text.slice(0,50)}\x1b[0m`);
        }
        return next();
    });

    b.catch((err, ctx) => {
        const msg = err?.message||String(err);
        if (!['blocked','not found','kicked','deactivated','Too Many Requests'].some(s=>msg.includes(s)))
            console.error(`  \x1b[31m[TG ERR]\x1b[0m ${ctx?.updateType}: ${msg.slice(0,100)}`);
    });

    // ── /start ───────────────────────────────────────────
    b.command('start', async ctx => {
        await rep(ctx,
            '🎣 *Selamat datang di Fisch Bot Telegram!*\n\n' +
            'Bot mancing WA ↔ Telegram — data sinkron penuh.\n\n' +
            '*Cara mulai:*\n' +
            '1\\. Chat bot WA → ketik `.linktele`\n' +
            '2\\. Salin kode 6 digit\n' +
            '3\\. Ketik `/confirm <kode>` di sini\n\n' +
            '📖 `/tutorial` — Panduan lengkap\n' +
            '📋 `/help` — Semua perintah'
        );
    });

    // ── /help ─────────────────────────────────────────────
    b.command('help', async ctx => {
        await rep(ctx,
            '📋 *FISCH BOT — SEMUA PERINTAH*\n━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '*🔗 Akun*\n`/confirm` `/resetsession` `/me` `/rename` `/stats`\n\n' +
            '*🎣 Mancing*\n`/mancing` `/view` `/reel` `/streak`\n\n' +
            '*🎒 Inventory*\n`/inventory` `/sell [filter]` `/fishbook` `/mutationbook` `/biggestfish`\n\n' +
            '*🎣 Rod*\n`/shop` `/buy` `/equip` `/listrod` `/enchant` `/listenchant` `/rodupgrade` `/skin`\n\n' +
            '*⬆️ Progress*\n`/upgrade [stat]` `/prestige` `/daily` `/gacha [pull/multi/coins]`\n\n' +
            '*🪙 Token & Gacha*\n`/tokenstore` `/jackpot <jumlah>`\n\n' +
            '*🏝️ Dunia*\n`/travel [pulau]` `/weather` `/boss` `/boss attack` `/event`\n\n' +
            '*🏆 Kompetisi*\n`/top` `/season` `/achievement` `/donate <jumlah>`\n\n' +
            '*💰 Ekonomi*\n`/money` `/transfer <user> <jumlah>` `/currency`\n\n' +
            '*👥 Sosial*\n`/addfriend` `/acceptfriend` `/declinefriend` `/delfriend`\n`/listfriend` `/requestfriends` `/player <user>`\n\n' +
            '*📖 Info*\n`/tutorial [1-10]` `/currency`\n\n' +
            '_Data sinkron WA_ 🔄 | _/tutorial untuk panduan_'
        );
    });

    // ── /tutorial ─────────────────────────────────────────
    b.command('tutorial', async ctx => {
        const pg = (ctx.message.text.trim().split(/\s+/)[1]||'').toLowerCase();
        if (!pg) return rep(ctx,
            '📖 *TUTORIAL FISCH BOT*\n━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '`/tutorial 1` — 🎣 Cara Mancing\n`/tutorial 2` — 🏝️ Sistem Pulau\n' +
            '`/tutorial 3` — 🎣 Rod & Upgrade\n`/tutorial 4` — 🧬 Mutasi & Rarity\n' +
            '`/tutorial 5` — 💰 Cara Dapat Uang\n`/tutorial 6` — ⬆️ Upgrade & Prestige\n' +
            '`/tutorial 7` — 🎰 Gacha System\n`/tutorial 8` — 🌦️ Cuaca & Streak\n' +
            '`/tutorial 9` — ⚔️ World Boss\n`/tutorial 10` — 🏆 Achievement'
        );
        const pages = {
            '1':'🎣 *CARA MANCING*\n━━━━━━━━━━━━━━\n\n1\\. `/mancing` — lempar pancingan\n2\\. Tunggu beberapa detik\n3\\. `/view` — ambil hasil\n4\\. `/sell` — jual ikan\n\n🎯 *Perfect Catch:* Kirim `/reel` di waktu tepat → bonus harga ×1\\.5–×2\\.5!\n\n💡 *Speed* rod = waktu lebih singkat\n💡 *Luck* rod = ikan lebih langka',
            '2':'🏝️ *SISTEM PULAU*\n━━━━━━━━━━━━━━\n\nTiap pulau punya ikan eksklusif!\n\n🟢 Mousewood — Gratis\n🟢 Roslit Bay — 5k + 5x mancing\n🟡 Mushgrove Swamp — 25k + 20x\n🟡 Terrapin Island — 100k + 50x\n🔴 The Ocean — 1M + 100x\n🔴 Atlantis — 10M + 200x\n⚫ Volcani Depths — 100M + 400x\n⚫ Crystal Caves — 1B + 750x\n\nPindah: `/travel mousewood`',
            '3':'🎣 *ROD & UPGRADE*\n━━━━━━━━━━━━━━\n\n🍀 *Luck* — ikan langka lebih sering\n⚡ *Speed* — waktu tunggu lebih cepat\n💰 *Sell Multiplier* — bonus jual\n🐟 *Combo Fish* — tangkap beberapa ikan\n🧬 *Mutation Luck* — mutasi langka\n\n`/shop` → `/buy <rod>` → `/equip <rod>`\n`/enchant` — Pasang enchant random\n`/rodupgrade confirm` — Upgrade permanen',
            '4':'🧬 *MUTASI & RARITY*\n━━━━━━━━━━━━━━\n\n*Rarity:*\n⚪ Common → 🟢 Uncommon → 💚 Rare\n💙 Epic → 💛 Legendary → 🟣 Mythic\n🌟 Godly → ⚫ Secret → 🦕 Extinct\n\n*Mutasi (bonus harga):*\nNormal ×1 | Albino ×1\\.5 | Gilded ×2\nTitanic ×3 | Shiny ×4 | Irradiated ×5\nCrystalline ×6 | Radioactive ×8\nAbyssal ×10 | Cosmic ×15 | Void ×25 | Divine ×50',
            '5':'💰 *CARA DAPAT UANG*\n━━━━━━━━━━━━━━\n\n1\\. Mancing & jual: `/mancing` → `/view` → `/sell`\n2\\. Filter jual: `/sell common` atau `/sell rare+`\n3\\. Fishing Streak: mancing beruntun → bonus jual\n4\\. Cuaca hujan/badai: ikan langka lebih sering\n5\\. `/daily` — Reward harian (streak 7 hari = 10M!)\n6\\. `/gacha pull` — Bisa dapat rod mahal\n7\\. `/jackpot` — Gambling 40% menang ×2\\.5',
            '6':'⬆️ *UPGRADE & PRESTIGE*\n━━━━━━━━━━━━━━\n\n*Upgrade Stats:*\n`/upgrade luck` — +2% luck per level (max 50)\n`/upgrade speed` — \\-1% wait per level (max 40)\n`/upgrade sell` — +5% sell per level (max 60)\n\n*Prestige:*\nSetelah cukup mancing & uang → `/prestige`\nDapat: Token, rod eksklusif, title baru\nGunakan token: `/tokenstore`\n\n`/rodupgrade` — Upgrade rod aktif permanen (mahal!)',
            '7':'🎰 *GACHA SYSTEM*\n━━━━━━━━━━━━━━\n\n`/gacha` — Info gacha\n`/gacha pull` — 1x pull (1 tiket)\n`/gacha multi` — 10x pull (10 tiket, hemat!)\n`/gacha coins` — 1x pull (5M coins)\n\nPity: setelah 80 pull tanpa SSR → SSR guaranteed!\n\n*Pool:*\n⚪ Common 55%: Scroll, Tiket, XP Boost\n🟢 Rare 25%: Rod, Scroll, Bait\n🔵 Epic 13%: Rod, Scroll, Tokens\n🟡 Legendary 6%: Rod Midas/Avalanche\n⭐ SSR 1%: Void/Cosmic Rod, 200 Tokens',
            '8':'🌦️ *CUACA & STREAK*\n━━━━━━━━━━━━━━\n\n*Cuaca berganti tiap 2 jam:*\n☀️ Cerah — Normal\n🌧️ Hujan — Luck +20%!\n⛈️ Badai — Luck +45%!\n🌙 Cahaya Bulan — Secret boost!\n\n*Fishing Streak (mancing non-common beruntun):*\n🔥 3x → Jual +10%\n⚡ 10x → Jual +35% + Luck bonus\n🌋 50x → Jual +100%\n🌌 100x → Jual ×3!\n\nStreak reset jika dapat ikan Common!',
            '9':'⚔️ *WORLD BOSS*\n━━━━━━━━━━━━━━\n\n`/boss` — Cek boss aktif\n`/boss attack` — Serang! (cooldown 30 detik)\n\nBoss dikalahkan bersama semua pemain!\nReward dibagi berdasarkan damage.\n\n🦑 Kraken Jr. — HP: 10\\.000\n🌊 Leviathan — HP: 50\\.000\n\n🎁 Reward: money + tokens + tiket gacha',
            '10':'🏆 *ACHIEVEMENT*\n━━━━━━━━━━━━━━\n\n34 achievement tersedia!\n\n🎣 Memancing: 10/50/100/500/1000 ikan\n💎 Rarity: tangkap rare/epic/legendary pertama\n🧬 Mutasi: 10 mutasi berbeda\n💰 Kekayaan: 1M/1B/1T coins\n🎣 Rod: level 5/20, punya 3/7 rod\n🏝️ Eksplorasi: kunjungi semua pulau\n⭐ Spesial: mancing badai → mythic!\n\nTiap achievement kasih reward otomatis!\n`/achievement` — Cek progress',
        };
        const page = pages[pg];
        if (!page) return rep(ctx, '❌ Halaman tidak ada. Ketik `/tutorial` untuk daftar.');
        await rep(ctx, page);
    });

    // ── /currency ─────────────────────────────────────────
    b.command('currency', async ctx => {
        await rep(ctx,
            '💱 *DAFTAR MATA UANG*\n━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '*🪙 Coins (uang utama)*\nDapat dari: mancing & jual\nDipakai: beli rod, enchant, skin, upgrade\n\n' +
            '`1k` = 1\\.000 | `1M` = 1\\.000\\.000\n`1B` = 1\\.000\\.000\\.000 | `1T` = 1\\.000\\.000\\.000\\.000\n\n' +
            '*🎟️ Gacha Tickets*\nDapat dari: daily reward, achievement\nDipakai: pull gacha\n\n' +
            '*🪙 Prestige Tokens*\nDapat dari: prestige, boss reward, gacha\nDipakai: /tokenstore (rod langka, skin)\n\n' +
            '*⭐ Achievement Points*\nDapat dari: selesaikan achievement\nDipakai: unlock skin Rainbow (50 pts)\n\n' +
            '*🏆 Season Points*\nDapat dari: mancing (makin langka makin banyak)\nDipakai: ranking season, reward akhir season\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━\n*Cara baca:* `2\\.5B` = 2\\.500\\.000\\.000'
        );
    });

    // ── /confirm ──────────────────────────────────────────
    b.command('confirm', async ctx => {
        try {
            const kode = ctx.message.text.trim().split(/\s+/)[1]?.trim();
            if (!kode) return rep(ctx, '❌ Format: `/confirm 123456`\n\nBelum punya kode? Chat bot WA → `.linktele`');
            const tgId = String(ctx.from.id);
            const already = await Player_.findOne({ isVerifiedTelegram:true, telegramId:tgId });
            if (already) return rep(ctx, `✅ Sudah terhubung ke *${esc(already.username)}*.\n/resetsession untuk ganti.`);
            const sess = await Session_.findOne({ verificationCode:String(kode), expiresAt:{$gt:new Date()} });
            if (!sess) return rep(ctx, '❌ *Kode tidak valid atau kadaluarsa.*\n\n💡 Kode berlaku 5 menit. Ketik `.linktele` di WA untuk kode baru.');
            const used = await Player_.findOne({ isVerifiedTelegram:true, telegramId:{$ne:tgId}, whatsappNumber:sess.tempWhatsAppNumber });
            if (used) { await Session_.deleteOne({_id:sess._id}); return rep(ctx, '❌ Kode ini sudah dipakai Telegram lain.'); }
            const user = await Player_.findOne({ whatsappNumber:sess.tempWhatsAppNumber });
            if (!user) return rep(ctx, '❌ Nomor WA tidak ditemukan. Pastikan sudah chat bot WA dulu.');
            user.isVerifiedTelegram = true;
            user.telegramId         = tgId;
            user.telegramUsername   = ctx.from.username||null;
            user.telegramUUID       = crypto.randomUUID();
            user.telegramConnectID  = genID();
            await user.save();
            await Session_.deleteOne({_id:sess._id});
            // Notif ke WA
            if (waClient_) {
                try {
                    const tgUser = ctx.from.username ? `@${ctx.from.username}` : `ID: ${tgId}`;
                    await waClient_.sendMessage(sess.tempWhatsAppNumber+'@s.whatsapp.net', {
                        text: `🎉 *Telegram Berhasil Dihubungkan!*\n\n✅ Akun WA-mu terhubung ke Telegram!\n📱 Telegram: *${tgUser}*\n🆔 Connect ID: \`${user.telegramConnectID}\`\n\nSekarang kamu bisa mancing dari Telegram!\nData sinkron otomatis 🔄\n\n💡 Ketik *.unlinktele* untuk putus koneksi`
                    });
                } catch (_) {}
            }
            await rep(ctx,
                '🎉 *Verifikasi Berhasil!*\n\n' +
                `👤 Username: *${esc(user.username)}*\n` +
                `📱 WA: \`${sess.tempWhatsAppNumber}\`\n` +
                `🆔 Connect ID: \`${user.telegramConnectID}\`\n\n` +
                '📨 Notifikasi sudah dikirim ke WA kamu!\nKetik /help untuk daftar perintah.'
            );
        } catch (e) { console.error('[TG /confirm]', e.message); await rep(ctx, '❌ Server error. Coba lagi.'); }
    });

    b.command('resetsession', async ctx => {
        try {
            const tgId = String(ctx.from.id);
            const p = await Player_.findOne({ telegramId:tgId });
            if (!p) return rep(ctx, '⚠️ Tidak ada akun yang terhubung.');
            const name = p.username;
            p.isVerifiedTelegram = false;
            p.telegramId = p.telegramUUID = p.telegramConnectID = p.telegramUsername = null;
            await p.save();
            await Session_.deleteMany({ tempTelegramId:tgId });
            await rep(ctx, `✅ Akun *${esc(name)}* diputus.\nKetik \`.linktele\` di WA untuk hubungkan ulang.`);
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    // ── /me & /money & /rename ────────────────────────────
    b.command('me', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const rod    = p.fishingRods?.get?.(p.usedFishingRod);
            const streak = TG_STREAKS.get(String(ctx.from.id)) || 0;
            const skin   = SKINS[p.equippedSkin||'default'];
            await rep(ctx,
                `👤 *${esc(p.username)}* ${skin?.emoji||'🎣'}\n\n` +
                `🆔 ID: \`${p.id}\`\n` +
                `⭐ Level: *${p.level}* (${fmt(p.exp)}/${fmt(p.expToNextLevel)} EXP)\n` +
                `💰 Coins: *${fmt(p.money)}*\n` +
                `🎟️ Tiket: *${p.gachaTickets||0}* | 🪙 Tokens: *${p.prestigeTokens||0}*\n` +
                `🎣 Rod: *${esc(rod?.name||'Tidak ada')}*${rod?.enchant?' ✨'+esc(rod.enchant):''}\n` +
                `🏝️ Pulau: *${esc(ISLANDS[p.currentIsland]?.name||p.currentIsland||'Mousewood')}*\n` +
                `🐟 Mancing: *${p.fishCaught||0}x* | 🧬 Mutasi: *${p.mutationFound?.length||0}*\n` +
                `🏆 Achievement: *${p.achievements?.length||0}* (${p.achievementPoints||0} pts)\n` +
                `🔥 Streak: *${streak}x* | 👑 Prestige: *${p.prestige||0}*\n` +
                `🔥 Daily Streak: *${p.dailyStreak||0}* hari\n` +
                `🐳 Biggest: *${p.biggestFish?`${esc(p.biggestFish.name)} (${p.biggestFish.kg}kg)`:'Belum ada'}*`
            );
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    b.command('money', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            await rep(ctx,
                `💰 *${esc(p.username)}*\n\n` +
                `🪙 Coins: *${fmt(p.money)}*\n` +
                `🎟️ Tiket Gacha: *${p.gachaTickets||0}*\n` +
                `🪙 Prestige Tokens: *${p.prestigeTokens||0}*\n` +
                `⭐ Achievement Pts: *${p.achievementPoints||0}*\n` +
                `🏆 Season Points: *${fmt(p.seasonPoints||0)}*\n\n` +
                `_/currency — Info semua mata uang_`
            );
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    b.command('stats', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const rod = p.fishingRods?.get?.(p.usedFishingRod);
            const luckUpg  = UPGRADES.luck.effect(p.luckUpgrade||0);
            const speedUpg = UPGRADES.speed.effect(p.speedUpgrade||0);
            const sellUpg  = UPGRADES.sell.effect(p.sellUpgrade||0);
            const totalLuck = Math.min((rod?.luck||0)+luckUpg, 1.5);
            const totalSpeed= Math.min((rod?.speed||0)+speedUpg, 0.99);
            const totalSell = 1+(rod?.sellMultiplier||0)+sellUpg;
            await rep(ctx,
                `📊 *Stats ${esc(p.username)}*\n━━━━━━━━━━━━━━\n` +
                `🎖️ Title: *${esc(p.title||PRESTIGE_TITLES[p.prestige||0]||'Pemancing Baru')}*\n` +
                `👑 Prestige: *${p.prestige||0}*\n` +
                `🪙 Tokens: *${p.prestigeTokens||0}*\n` +
                `🎟️ Tiket Gacha: *${p.gachaTickets||0}*\n` +
                `🔥 Daily Streak: *${p.dailyStreak||0}* hari\n\n` +
                `📈 *Upgrade Permanen:*\n` +
                `  🍀 Luck: +${(luckUpg*100).toFixed(0)}% (Lv.${p.luckUpgrade||0}/${UPGRADES.luck.maxLevel})\n` +
                `  ⚡ Speed: -${(speedUpg*100).toFixed(0)}% wait (Lv.${p.speedUpgrade||0}/${UPGRADES.speed.maxLevel})\n` +
                `  💰 Sell: +${(sellUpg*100).toFixed(0)}% (Lv.${p.sellUpgrade||0}/${UPGRADES.sell.maxLevel})\n\n` +
                `🎣 *Total Stats (rod+upgrade):*\n` +
                `  🍀 Luck: ${(totalLuck*100).toFixed(1)}%\n` +
                `  ⚡ Speed: ${(totalSpeed*100).toFixed(1)}%\n` +
                `  💰 Sell: ×${totalSell.toFixed(2)}\n\n` +
                `🏆 Season Pts: *${fmt(p.seasonPoints||0)}* | Wins: *${p.seasonWins||0}*`
            );
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    b.command('rename', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const nama = ctx.message.text.trim().split(/\s+/).slice(1).join(' ').trim().toLowerCase();
            if (!nama) return rep(ctx, '❌ Format: `/rename namabaru`');
            if (nama.length<3||nama.length>20) return rep(ctx, '❌ Nama 3–20 karakter.');
            if (!/^[a-z0-9 ]+$/.test(nama)) return rep(ctx, '❌ Hanya huruf kecil, angka, spasi.');
            if (await Player_.exists({username:nama})) return rep(ctx, `⚠️ Nama *${esc(nama)}* sudah dipakai.`);
            const lama = p.username; p.username=nama; await p.save();
            await rep(ctx, `✅ *${esc(lama)}* → *${esc(nama)}*`);
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    // ── /daily ────────────────────────────────────────────
    b.command('daily', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const now  = new Date();
            const last = p.lastDaily ? new Date(p.lastDaily) : null;
            if (last) {
                const diffH = (now-last)/(1000*60*60);
                if (diffH < 20) {
                    const next = new Date(last.getTime()+20*60*60*1000);
                    const wh   = Math.floor((next-now)/(1000*60*60));
                    const wm   = Math.floor(((next-now)%(1000*60*60))/(1000*60));
                    return rep(ctx, `⏳ Daily sudah diambil!\nBisa lagi dalam *${wh}j ${wm}m*\n\n🔥 Streak: *${p.dailyStreak||1}* hari`);
                }
                if ((now-last)/(1000*60*60*24) > 2) p.dailyStreak = 0;
            }
            p.dailyStreak = (p.dailyStreak||0)+1;
            p.lastDaily   = now;
            const sd = p.dailyStreak;
            let reward = DAILY_REWARDS[0];
            for (const r of [...DAILY_REWARDS].reverse()) { if (sd>=r.streak){reward=r;break;} }
            const finalMoney = reward.money;
            p.money        = (p.money||0)+finalMoney;
            p.gachaTickets = (p.gachaTickets||0)+reward.tickets;
            await p.save();
            let txt = `🎁 *Daily Reward!*\n━━━━━━━━━━━━━━\n${reward.desc}\n\n`;
            txt += `💰 +${fmt(finalMoney)} coins\n`;
            if (reward.tickets) txt += `🎟️ +${reward.tickets} tiket gacha!\n`;
            txt += `\n🔥 Streak: *${sd}* hari\n💰 Saldo: *${fmt(p.money)}*\n🎟️ Tiket: *${p.gachaTickets}*`;
            await rep(ctx, txt);
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    // ── /upgrade ──────────────────────────────────────────
    b.command('upgrade', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const upKey = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
            if (!upKey) {
                let txt = `⬆️ *Upgrade Stats*\n━━━━━━━━━━━━━━\n💰 Saldo: *${fmt(p.money)}*\n\n`;
                for (const [k,upg] of Object.entries(UPGRADES)) {
                    const lv = p[k+'Upgrade']||0;
                    const cost = lv<upg.maxLevel?fmt(upg.getCost(lv)):'MAX';
                    txt += `${upg.name}\n  Lv.${lv}/${upg.maxLevel} | Efek: +${(upg.effect(lv)*100).toFixed(0)}% | Biaya: ${cost}\n  → \`/upgrade ${k}\`\n\n`;
                }
                return rep(ctx, txt);
            }
            const upg = UPGRADES[upKey];
            if (!upg) return rep(ctx, `❌ Stat tidak ada. Pilih: ${Object.keys(UPGRADES).join(', ')}`);
            const lv = p[upKey+'Upgrade']||0;
            if (lv>=upg.maxLevel) return rep(ctx, `✅ *${upg.name}* sudah MAX Level ${upg.maxLevel}!`);
            const cost = upg.getCost(lv);
            if ((p.money||0)<cost) return rep(ctx, `💸 Butuh *${fmt(cost)}*\nPunya: *${fmt(p.money)}*`);
            p.money -= cost;
            p[upKey+'Upgrade'] = lv+1;
            await p.save();
            await rep(ctx,
                `✅ *${upg.name}* naik ke Level *${lv+1}*!\n\n` +
                `📊 Efek: +${(upg.effect(lv+1)*100).toFixed(0)}%\n` +
                `💸 Biaya: ${fmt(cost)}\n💰 Saldo: ${fmt(p.money)}`
            );
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    // ── /prestige ─────────────────────────────────────────
    b.command('prestige', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const lv  = p.prestige||0;
            const req = PRESTIGE_REQ[lv];
            const arg = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
            if (arg==='confirm') {
                if (!req) return rep(ctx, '❌ Sudah prestige maksimal!');
                if ((p.fishCaught||0)<req.fish) return rep(ctx, `❌ Mancing kurang! ${req.fish-(p.fishCaught||0)}x lagi.`);
                if ((p.money||0)<req.money) return rep(ctx, `❌ Uang kurang! Butuh *${fmt(req.money-(p.money||0))}* lagi.`);
                p.money -= req.money;
                p.prestige = lv+1;
                p.prestigeTokens = (p.prestigeTokens||0)+100;
                p.title = PRESTIGE_TITLES[p.prestige]||`Prestige ${p.prestige}`;
                if (ROD_SHOP.prestigerod && !p.fishingRods?.get?.('prestigerod')) {
                    p.fishingRods = p.fishingRods||new Map();
                    p.fishingRods.set('prestigerod',{...ROD_SHOP.prestigerod});
                    p.markModified('fishingRods');
                }
                if (p.prestige>=3 && ROD_SHOP.cosmicrod && !p.fishingRods?.get?.('cosmicrod')) {
                    p.fishingRods.set('cosmicrod',{...ROD_SHOP.cosmicrod}); p.markModified('fishingRods');
                }
                if (p.prestige>=5 && ROD_SHOP.eternityrod && !p.fishingRods?.get?.('eternityrod')) {
                    p.fishingRods.set('eternityrod',{...ROD_SHOP.eternityrod}); p.markModified('fishingRods');
                }
                await p.save();
                return rep(ctx, `🎉 *PRESTIGE ${p.prestige} UNLOCKED!*\n\n🎖️ Title: *${esc(p.title)}*\n🪙 +100 Tokens!\n🎁 ${req.reward}\n\n💡 Gunakan /tokenstore untuk belanja.`);
            }
            if (!req) return rep(ctx, `👑 *Prestige ${lv}* — Level tertinggi!\n🎖️ Title: *${esc(p.title||PRESTIGE_TITLES[lv])}*\n🪙 Tokens: *${p.prestigeTokens||0}*`);
            const can = (p.fishCaught||0)>=req.fish && (p.money||0)>=req.money;
            let txt = `👑 *Sistem Prestige*\n━━━━━━━━━━━━━━\n🎖️ Level: *Prestige ${lv}*\n🪙 Tokens: *${p.prestigeTokens||0}*\n\n`;
            txt += `⬆️ *Syarat Prestige ${lv+1}:*\n🐟 Mancing: *${p.fishCaught||0}/${req.fish}*\n💰 Uang: *${fmt(p.money||0)}/${fmt(req.money)}*\n\n`;
            txt += `🎁 Hadiah: ${req.reward}\n\n`;
            txt += can ? '✅ *Kamu sudah memenuhi syarat!*\nKetik `/prestige confirm` untuk naik.' : '❌ Belum memenuhi syarat.';
            await rep(ctx, txt);
        } catch (e) { await rep(ctx, '❌ Terjadi kesalahan.'); }
    });

    // ── /gacha ────────────────────────────────────────────
    b.command('gacha', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const mode = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
            if (!mode) return rep(ctx,
                `🎰 *Gacha Fisch*\n━━━━━━━━━━━━━━\n🎟️ Tiket: *${p.gachaTickets||0}* | 🔄 Pity: *${p.gachaPity||0}/${GACHA_PITY}*\n\n` +
                `\`/gacha pull\` — 1x (1 tiket)\n\`/gacha multi\` — 10x (10 tiket)\n\`/gacha coins\` — 1x (${fmt(GACHA_COINS)} coins)\n\n` +
                `⚪ Common 55% | 🟢 Rare 25% | 🔵 Epic 13%\n🟡 Legendary 6% | ⭐ SSR 1%\n🔄 Pity ${GACHA_PITY}x: SSR guaranteed!`
            );
            const pulls = mode==='multi'?10:1;
            if (mode==='coins') {
                if ((p.money||0)<GACHA_COINS) return rep(ctx, `💸 Butuh *${fmt(GACHA_COINS)}* coins.`);
                p.money -= GACHA_COINS;
            } else {
                if ((p.gachaTickets||0)<pulls) return rep(ctx, `🎟️ Butuh *${pulls}* tiket. Punya *${p.gachaTickets||0}*.`);
                p.gachaTickets -= pulls;
            }
            const rarE = {common:'⚪',rare:'🟢',epic:'🔵',legendary:'🟡',ssr:'⭐'};
            const rarL = {common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',ssr:'SSR ✨'};
            const results = [];
            for (let i=0;i<pulls;i++) {
                const {item,pity} = doPull(p);
                applyGachaItem(p, item);
                results.push({item,pity});
            }
            await p.save();
            let txt = `🎰 *Hasil Gacha (${pulls}x)*\n━━━━━━━━━━━━━━\n\n`;
            for (const {item,pity} of results) {
                txt += `${rarE[item.rarity]||'⚪'} \\[${rarL[item.rarity]||item.rarity}\\] ${esc(item.label)}${pity?' ← PITY!':''}\n`;
            }
            txt += `\n─────────────\n💰 Saldo: *${fmt(p.money)}*\n🎟️ Tiket: *${p.gachaTickets||0}*\n🪙 Tokens: *${p.prestigeTokens||0}*\n🔄 Pity: *${p.gachaPity||0}/${GACHA_PITY}*`;
            await rep(ctx, txt);
        } catch (e) { console.error('[TG /gacha]',e.message); await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /tokenstore ───────────────────────────────────────
    b.command('tokenstore', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const args = ctx.message.text.trim().split(/\s+/);
            if (args[1]!=='beli') {
                let txt = `🪙 *Prestige Token Store*\n━━━━━━━━━━━━━━\n🪙 Tokens kamu: *${p.prestigeTokens||0}*\n\n`;
                TOKEN_SHOP.forEach((item,i) => { txt += `${i+1}\\. ${esc(item.name)} — *${item.cost} tokens*\n`; });
                txt += '\nKetik `/tokenstore beli <nomor>`';
                return rep(ctx, txt);
            }
            const idx = parseInt(args[2])-1;
            if (isNaN(idx)||idx<0||idx>=TOKEN_SHOP.length) return rep(ctx,'❌ Nomor tidak valid.');
            const item = TOKEN_SHOP[idx];
            if ((p.prestigeTokens||0)<item.cost) return rep(ctx,`❌ Token kurang! Butuh *${item.cost}*, punya *${p.prestigeTokens||0}*.`);
            p.prestigeTokens -= item.cost;
            if (item.type==='rod') {
                if (p.fishingRods?.get?.(item.value)) return rep(ctx,`⚠️ Sudah punya *${esc(item.name)}*.`);
                p.fishingRods=p.fishingRods||new Map(); p.fishingRods.set(item.value,{...ROD_SHOP[item.value]||{}}); p.markModified('fishingRods');
            } else if (item.type==='tickets') { p.gachaTickets=(p.gachaTickets||0)+item.value; }
            else if (item.type==='coins') { p.money=(p.money||0)+item.value; }
            await p.save();
            await rep(ctx, `✅ *${esc(item.name)}* berhasil dibeli!\n🪙 Sisa tokens: *${p.prestigeTokens}*`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /jackpot ──────────────────────────────────────────
    b.command('jackpot', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const betStr = ctx.message.text.trim().split(/\s+/)[1];
            if (!betStr) return rep(ctx,
                `🎲 *Jackpot Gamble*\n━━━━━━━━━━━━━━\nTaruhan uangmu! Menang *40%* → dapat *×2\\.5*\nKalah → uang hilang\n\nFormat: \`/jackpot <jumlah>\`\nContoh: \`/jackpot 1B\``
            );
            const bet = parseAmount(betStr);
            if (isNaN(bet)||bet<=0) return rep(ctx,'❌ Jumlah tidak valid.');
            if (bet>(p.money||0)) return rep(ctx,`💸 Saldo tidak cukup! Punya: *${fmt(p.money)}*`);
            if (bet<1_000_000) return rep(ctx,'❌ Taruhan minimum *1M*.');
            const win = Math.random()<0.40;
            if (win) {
                const gain = Math.floor(bet*2.5);
                p.money = (p.money||0)-bet+gain;
                await p.save();
                await rep(ctx,`🎲 *MENANG!* 🎉\n\n💰 Taruhan: ${fmt(bet)}\n💵 Dapat: *+${fmt(gain)}*\n💰 Saldo: *${fmt(p.money)}*`);
            } else {
                p.money = (p.money||0)-bet;
                await p.save();
                await rep(ctx,`🎲 *KALAH!*\n\n💰 Taruhan: ${fmt(bet)}\n💸 Hilang: *\\-${fmt(bet)}*\n💰 Saldo: *${fmt(p.money)}*`);
            }
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /donate ───────────────────────────────────────────
    b.command('donate', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const amtStr = ctx.message.text.trim().split(/\s+/)[1];
            if (!amtStr) return rep(ctx,'💝 *Donasi ke Dewa Laut*\n\nSetiap 1M didonasikan = 100 Season Points!\n\nFormat: `/donate <jumlah>`');
            const amount = parseAmount(amtStr);
            if (isNaN(amount)||amount<=0) return rep(ctx,'❌ Jumlah tidak valid.');
            if (amount>(p.money||0)) return rep(ctx,'💸 Uang tidak cukup!');
            const pts = Math.floor(amount/1_000_000)*100;
            p.money -= amount;
            p.seasonPoints = (p.seasonPoints||0)+pts;
            await p.save();
            await rep(ctx,`💝 Donasi *${fmt(amount)}* ke Dewa Laut!\n\n🏆 +${fmt(pts)} Season Points\n💰 Saldo: *${fmt(p.money)}*`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /event ────────────────────────────────────────────
    b.command('event', async ctx => {
        await rep(ctx,
            '🎪 *Event Aktif*\n\nInfo event dikelola server WA\\.\n\nCek di WA: `.event`\n\nEvent aktif memberikan bonus:\n• Sell multiplier lebih tinggi\n• Mutation chance naik\n• Exclusive fish muncul'
        );
    });

    // ── /weather ──────────────────────────────────────────
    b.command('weather', async ctx => {
        await rep(ctx,
            '🌦️ *Cuaca Game*\n\nCuaca dikelola server WA dan berganti tiap *2 jam*\\.\n\nCek real\\-time di WA: `.cuaca`\n\n*Jenis cuaca:*\n☀️ Cerah — Normal\n☁️ Mendung — +5% luck\n🌧️ Hujan — +20% luck!\n⛈️ Badai — +45% luck!\n🌫️ Berkabut — mutasi boost\n💨 Berangin — speed +30%\n❄️ Blizzard — +35% luck\n🌙 Cahaya Bulan — Secret boost!'
        );
    });

    // ── /mancing ──────────────────────────────────────────
    b.command('mancing', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const rod = p.fishingRods?.get?.(p.usedFishingRod);
            if (!rod) return rep(ctx,'⚠️ Belum punya rod! Ketik /shop.');
            const now = Date.now();
            const pending = (p.fishingPending||[]).find(x=>x.sender===p.whatsappNumber);
            if (pending) {
                if (now>=pending.readyAt) return rep(ctx,'🐟 *Ikan sudah menggigit!*\nKetik /view untuk ambil.\n🎯 Atau /reel untuk Perfect Catch!');
                const rem = ((pending.readyAt-now)/1000).toFixed(0);
                const streak = TG_STREAKS.get(String(ctx.from.id))||0;
                return rep(ctx,`🎣 *Sedang Memancing...*\n🏝️ ${esc(ISLANDS[pending.island]?.name||pending.island)}\n⏳ *${rem} detik* lagi\n`+(streak>=3?`🔥 Streak: *${streak}x*\n`:'')+'\n🎯 Kirim /reel saat ikan menggigit!');
            }
            const luckUpg  = UPGRADES.luck.effect(p.luckUpgrade||0);
            const speedUpg = UPGRADES.speed.effect(p.speedUpgrade||0);
            const totalSpeed = Math.min((rod.speed||0)+speedUpg, 0.95);
            const baseWait = 1000*(5+Math.random()*7);
            const wait = Math.max(2000, Math.round(baseWait*(1-totalSpeed)));
            const island = p.currentIsland||'mousewood';
            p.fishingPending = p.fishingPending||[];
            p.fishingPending.push({ sender:p.whatsappNumber, start:now, readyAt:now+wait, rod:p.usedFishingRod, island, fishes:[], comboFish:rod.comboFish||1 });
            // Setup reel window
            const reelDelay = 2000+Math.random()*8000;
            TG_REEL_WIN.set(String(ctx.from.id), { windowStart:now+reelDelay, windowEnd:now+reelDelay+4000 });
            await p.save();
            const streak = TG_STREAKS.get(String(ctx.from.id))||0;
            await rep(ctx,
                `🎣 *Mulai Memancing!*\n${'─'.repeat(22)}\n\n` +
                `🏝️ Pulau: *${esc(ISLANDS[island]?.name||island)}*\n` +
                `🎣 Rod: *${esc(rod.name)}*${rod.enchant?' ✨'+esc(rod.enchant):''}\n` +
                `🍀 Luck: ${((Math.min((rod.luck||0)+luckUpg,1.5))*100).toFixed(1)}%\n` +
                (streak>=3?`🔥 Streak: *${streak}x* (×${streakMult(streak).toFixed(2)} sell)\n`:'')+
                `\n⏳ Ikan menggigit dalam *${(wait/1000).toFixed(1)}s*\n🎯 Kirim /reel saat waktu tepat untuk bonus!`
            );
        } catch (e) { console.error('[TG /mancing]',e.message); await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /reel ─────────────────────────────────────────────
    b.command('reel', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const tgId = String(ctx.from.id);
            const pending = (p.fishingPending||[]).find(x=>x.sender===p.whatsappNumber);
            if (!pending) return rep(ctx,'❌ Belum memancing. Ketik /mancing dulu!');
            const now = Date.now();
            const w = TG_REEL_WIN.get(tgId);
            if (!w) return rep(ctx,`⏳ Ikan belum menggigit! Coba lagi nanti.`);
            if (now<w.windowStart) return rep(ctx,`⏳ *Terlalu Cepat!* Tunggu ~*${((w.windowStart-now)/1000).toFixed(1)}s* lagi!`);
            if (now>w.windowEnd) { TG_REEL_WIN.delete(tgId); return rep(ctx,'😅 *Kelewatan!* Bonus hilang, tapi masih bisa /view untuk ikan biasa.'); }
            TG_REEL_WIN.delete(tgId);
            const bonus = parseFloat((1.5+Math.random()*1.0).toFixed(1));
            pending.perfectCatch = true; pending.perfectBonus = bonus;
            p.perfectCatches = (p.perfectCatches||0)+1;
            p.markModified('fishingPending');
            await p.save();
            await rep(ctx,`🎯 *PERFECT CATCH!*\n\nTiming sempurna! 🔥\n✨ Bonus harga: *×${bonus}*\n\nKetik /view untuk ambil hasil!`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /view ─────────────────────────────────────────────
    b.command('view', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const tgId = String(ctx.from.id);
            const now = Date.now();
            const pidx = (p.fishingPending||[]).findIndex(x=>x.sender===p.whatsappNumber);
            if (pidx===-1) return rep(ctx,'❌ Belum mancing. Ketik /mancing dulu!');
            const pending = p.fishingPending[pidx];
            if (now<pending.readyAt) {
                const rem = ((pending.readyAt-now)/1000).toFixed(0);
                return rep(ctx,`⏳ *Belum Menggigit!*\nTunggu *${rem} detik* lagi.\n🎯 Kirim /reel saat waktu tepat!`);
            }
            p.fishingPending.splice(pidx,1);
            const rod = p.fishingRods?.get?.(pending.rod);
            const luckUpg  = UPGRADES.luck.effect(p.luckUpgrade||0);
            const sellUpg  = UPGRADES.sell.effect(p.sellUpgrade||0);
            const boostedRod = rod ? { ...rod, luck:Math.min((rod.luck||0)+luckUpg,1.5), sellMultiplier:(rod.sellMultiplier||0)+sellUpg } : null;
            const totalFish = (rod?.comboFish)||1;
            const streak = TG_STREAKS.get(tgId)||0;
            const sm = streakMult(streak);
            const results = [];
            for (let i=0;i<totalFish;i++) {
                const fish = generateFish(boostedRod||{}, pending.island||'mousewood');
                if (pending.perfectCatch && pending.perfectBonus) fish.price = Math.round(fish.price*pending.perfectBonus);
                fish.price = Math.round(fish.price*sm);
                results.push(fish);
                p.inventory = p.inventory||[];
                p.inventory.push(fish);
                if (!p.fishFound) p.fishFound=[];
                if (!p.fishFound.includes(fish.name)) p.fishFound.push(fish.name);
                if (fish.isMutated) { if (!p.mutationFound) p.mutationFound=[]; for (const m of fish.mutations) { if (m!=='Normal'&&!p.mutationFound.includes(m)) p.mutationFound.push(m); } }
                if (!p.biggestFish||fish.kg>p.biggestFish.kg) p.biggestFish={name:fish.name,kg:fish.kg,price:fish.price,date:new Date()};
            }
            p.fishCaught = (p.fishCaught||0)+results.length;
            p.islandCooldowns = p.islandCooldowns||{}; p.islandCooldowns[pending.island]=now; p.markModified('islandCooldowns');
            const allNonCommon = results.every(f=>f.rarity!=='common');
            TG_STREAKS.set(tgId, allNonCommon?streak+results.length:0);
            const newStreak = TG_STREAKS.get(tgId);
            const totalVal = results.reduce((a,b)=>a+b.price,0);
            p.totalEarned = (p.totalEarned||0)+totalVal;
            const expGain = Math.floor(totalVal/15);
            p.exp=(p.exp||0)+expGain;
            while (p.exp>=(p.expToNextLevel||100)&&p.level<(p.maxLevel||9999)) { p.exp-=p.expToNextLevel; p.level++; p.expToNextLevel=Math.floor(p.expToNextLevel*1.2); }
            p.seasonPoints = (p.seasonPoints||0)+Math.floor(totalVal/10000);
            await p.save();
            TG_REEL_WIN.delete(tgId);
            const fishLines = results.map(f=>{
                const mutTxt=(f.mutations?.[0]&&f.mutations[0]!=='Normal')?` \\[${esc(f.mutations[0])}\\]`:'';
                return `${RE[f.rarity]||'⚪'} *${esc(f.name)}* _(${f.rarity})_${mutTxt}\n   ⚖️ ${f.kg}kg × ${fmt(f.pricePerKg)}/kg = *${fmt(f.price)}*`;
            }).join('\n\n');
            let footer = `\n\n💰 Total: *${fmt(totalVal)} coins*`;
            if (pending.perfectCatch) footer += `\n🎯 Perfect Catch ×${pending.perfectBonus}`;
            if (newStreak>=3) footer += `\n🔥 Streak: *${newStreak}x* (×${sm.toFixed(2)})`;
            footer += `\n📊 EXP +${fmt(expGain)} | Mancing: *${p.fishCaught}x*`;
            await rep(ctx, `🎣 *Hasil — ${esc(ISLANDS[pending.island]?.name||pending.island)}!*\n${'─'.repeat(22)}\n\n${fishLines}${footer}\n\n_/sell untuk jual | /inventory untuk tas_`);
        } catch (e) { console.error('[TG /view]',e.message); await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /streak ───────────────────────────────────────────
    b.command('streak', async ctx => {
        const s = TG_STREAKS.get(String(ctx.from.id))||0;
        const ms = [[3,'+10%'],[5,'+20%'],[10,'+35%+luck'],[20,'+50%'],[50,'+100%'],[100,'×3!']];
        let txt = `🔥 *Fishing Streak*\n\nStreak saat ini: *${s}x*\n\n*Milestone:*\n`;
        ms.forEach(([n,d])=>{ txt+=`${s>=n?'🔥':'⬜'} *${n}x* — Sell ${d}\n`; });
        txt+='\n⚠️ Streak reset jika dapat ikan Common!';
        await rep(ctx,txt);
    });

    // ── /inventory, /sell, /fishbook, /mutationbook, /biggestfish ──
    b.command('inventory', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const rod = p.fishingRods?.get?.(p.usedFishingRod);
            const fish = (p.inventory||[]).filter(x=>x.type==='fish');
            const total = fish.reduce((a,b)=>a+(b.price||0),0);
            let txt = `🎒 *Inventory ${esc(p.username)}*\n\n`;
            if (rod) txt += `🎣 *${esc(rod.name)}* Lv.${rod.level||1}/${rod.maxLevel}${rod.enchant?' ✨'+esc(rod.enchant):''}\n\n`;
            if (!fish.length) { txt+='🐟 Belum ada ikan\n'; }
            else {
                txt += `🐟 *Ikan (${fish.length}):*\n`;
                fish.slice(0,10).forEach((f,i)=>{ const mt=(f.mutations?.[0]&&f.mutations[0]!=='Normal')?` \\[${esc(f.mutations[0])}\\]`:''; txt+=`${i+1}\\. ${RE[f.rarity]||'⚪'} *${esc(f.name)}*${mt} — ${fmt(f.price)}\n`; });
                if (fish.length>10) txt+=`_\\.\\.\\. +${fish.length-10} lainnya_\n`;
                txt+=`\n💵 Total nilai: *${fmt(total)} coins*`;
            }
            const scrolls = (p.inventory||[]).filter(x=>x.type==='enchant_scroll');
            const baits   = (p.inventory||[]).filter(x=>x.type==='bait');
            if (scrolls.length) txt+=`\n📜 Enchant Scrolls: *${scrolls.length}*`;
            if (baits.length)   txt+=`\n🪱 Bait: *${baits.length}*`;
            txt+=`\n💰 Saldo: *${fmt(p.money)} coins*`;
            await rep(ctx,txt);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('sell', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const arg = (ctx.message.text.trim().split(/\s+/)[1]||'').toLowerCase();
            let fishToSell = (p.inventory||[]).filter(x=>x.type==='fish');
            if (!fishToSell.length) return rep(ctx,'📦 Tidak ada ikan untuk dijual.');
            if (arg&&arg!=='all') {
                if (arg.endsWith('+')) {
                    const base=arg.slice(0,-1), bi=RARITY_ORDER.indexOf(base);
                    if (bi<0) return rep(ctx,`❌ Rarity "${base}" tidak dikenal.`);
                    fishToSell = fishToSell.filter(f=>RARITY_ORDER.indexOf(f.rarity)>=bi);
                } else if (arg==='mutated'||arg==='mutasi') { fishToSell=fishToSell.filter(f=>f.isMutated); }
                else { const i=RARITY_ORDER.indexOf(arg); if(i<0) return rep(ctx,'❌ Filter tidak dikenal.\nContoh: /sell common | /sell rare+ | /sell mutasi'); fishToSell=fishToSell.filter(f=>f.rarity===arg); }
            }
            if (!fishToSell.length) return rep(ctx,`📦 Tidak ada ikan dengan filter *${arg}*`);
            const total = fishToSell.reduce((a,b)=>a+(b.price||0),0);
            const sellIds = new Set(fishToSell.map(f=>f.id));
            const byR = {};
            fishToSell.forEach(f=>{ if(!byR[f.rarity])byR[f.rarity]={count:0,total:0}; byR[f.rarity].count++; byR[f.rarity].total+=f.price||0; });
            p.money=(p.money||0)+total; p.totalEarned=(p.totalEarned||0)+total;
            p.inventory=(p.inventory||[]).filter(x=>!(x.type==='fish'&&sellIds.has(x.id)));
            await p.save();
            const lines = Object.entries(byR).sort((a,b)=>RARITY_ORDER.indexOf(b[0])-RARITY_ORDER.indexOf(a[0])).map(([r,d])=>`  ${RE[r]||'🐟'} ${r}: ${d.count}x → ${fmt(d.total)}`);
            await rep(ctx, `💰 *Hasil Penjualan*\n${'─'.repeat(22)}\n${lines.join('\n')}\n${'─'.repeat(22)}\n🐟 *${fishToSell.length} ekor* terjual\n💵 Pendapatan: *${fmt(total)}*\n💰 Saldo: *${fmt(p.money)}*\n\n_/sell common | /sell rare+ | /sell mutasi_`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('fishbook',     async ctx => { try { const p=await needLink(ctx); if(!p)return; const f=p.fishFound||[]; if(!f.length) return rep(ctx,'📖 Belum ada ikan. /mancing dulu!'); let txt=`📖 *Fishbook ${esc(p.username)}* (${f.length})\n\n`; f.slice(0,20).forEach((n,i)=>{txt+=`${i+1}\\. 🐟 ${esc(n)}\n`;}); if(f.length>20)txt+=`_\\.\\.\\. +${f.length-20} lainnya_`; await rep(ctx,txt); } catch(e){await rep(ctx,'❌ Terjadi kesalahan.');} });
    b.command('mutationbook',  async ctx => { try { const p=await needLink(ctx); if(!p)return; const f=p.mutationFound||[]; if(!f.length)return rep(ctx,'🧬 Belum ada mutasi.'); let txt=`🧬 *Mutationbook ${esc(p.username)}* (${f.length})\n\n`; f.slice(0,20).forEach((n,i)=>{txt+=`${i+1}\\. ✨ ${esc(n)}\n`;}); if(f.length>20)txt+=`_\\.\\.\\. +${f.length-20} lainnya_`; await rep(ctx,txt); } catch(e){await rep(ctx,'❌ Terjadi kesalahan.');} });
    b.command('biggestfish',   async ctx => { try { const p=await needLink(ctx); if(!p)return; if(!p.biggestFish)return rep(ctx,'🐟 Belum ada. /mancing dulu!'); const bf=p.biggestFish; await rep(ctx,`🐳 *Ikan Terbesar ${esc(p.username)}*\n\n🐟 *${esc(bf.name)}*\n⚖️ *${bf.kg} kg*\n💰 *${fmt(bf.price)} coins*\n📅 ${bf.date?new Date(bf.date).toLocaleDateString('id-ID'):'-'}`); } catch(e){await rep(ctx,'❌ Terjadi kesalahan.');} });

    // ── /listenchant ──────────────────────────────────────
    b.command('listenchant', async ctx => {
        try {
            const p = await needLink(ctx); if (!p) return;
            const scrolls = (p.inventory||[]).filter(x=>x.type==='enchant_scroll');
            if (!scrolls.length) return rep(ctx,'📜 Tidak ada enchant scroll di inventorymu.\nDapatkan dari /gacha!');
            let txt = `📜 *Enchant Scrolls* (${scrolls.length})\n\n`;
            scrolls.slice(0,10).forEach((s,i)=>{ txt+=`${i+1}\\. ${RE[s.rarity]||'⚪'} ${esc(s.label||s.rarity)}\n`; });
            if (scrolls.length>10) txt+=`_\\.\\.\\. +${scrolls.length-10} lainnya_`;
            txt+='\n\nPakai scroll: /enchant';
            await rep(ctx,txt);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /achievement ──────────────────────────────────────
    b.command('achievement', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const earned = p.achievements||[];
            const arg = (ctx.message.text.trim().split(/\s+/)[1]||'').toLowerCase();
            if (arg==='list') return rep(ctx,
                `🏆 *Semua Achievement (34)*\n\n` +
                `🎣 first\\_fish, fish\\_10, fish\\_50, fish\\_100, fish\\_500, fish\\_1000, fish\\_5000\n` +
                `💎 first\\_rare, first\\_epic, first\\_legendary, first\\_mythic, first\\_godly, first\\_secret, first\\_extinct\n` +
                `🧬 first\\_mutation, rare\\_fish\\_10, mutation\\_10\n` +
                `💰 money\\_1m, money\\_1b, money\\_1t, sell\\_100m\n` +
                `🎣 rod\\_level5, rod\\_level20, enchant\\_first, own\\_3rods, own\\_7rods\n` +
                `🏝️ visit\\_3islands, visit\\_all\n` +
                `⭐ big\\_fish, perfect\\_10, storm\\_fisher, night\\_catcher\n\n` +
                `_Progress: ${earned.length}/34_`
            );
            const recent = earned.slice(-5).reverse();
            await rep(ctx,
                `🏆 *Achievement ${esc(p.username)}*\n\n` +
                `📊 Progress: *${earned.length}/34*\n⭐ Poin: *${p.achievementPoints||0}*\n\n` +
                (recent.length?`🕐 *Terbaru:*\n${recent.map(id=>`  • ${esc(id)}`).join('\n')}\n\n`:'')+
                `_/achievement list — Lihat semua_`
            );
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /resetme ──────────────────────────────────────────
    b.command('resetme', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const arg = (ctx.message.text.trim().split(/\s+/)[1]||'').toLowerCase();
            if (arg!=='confirm') return rep(ctx,
                `⚠️ *Reset Akun*\n\nIni akan menghapus:\n• Semua inventory\n• Semua rod (kecuali basic)\n• Coins, exp, level\n• Achievement\n\nData yang TIDAK direset: username, teman, prestige\n\n⚠️ *Tindakan ini TIDAK BISA dibatalkan\\!*\n\nKetik \`/resetme confirm\` untuk lanjut`
            );
            const name = p.username;
            p.money = 0; p.exp = 0; p.level = 1; p.expToNextLevel = 100;
            p.fishCaught = 0; p.fishFound = []; p.mutationFound = [];
            p.inventory = []; p.achievements = []; p.achievementPoints = 0;
            p.seasonPoints = 0; p.dailyStreak = 0; p.gachaTickets = 0;
            p.biggestFish = null; p.totalEarned = 0;
            p.fishingRods = new Map(); p.markModified('fishingRods');
            p.usedFishingRod = null; p.currentIsland = 'mousewood';
            await p.save();
            await rep(ctx,`✅ Akun *${esc(name)}* berhasil direset.\nMulai dari nol! Ketik /mancing untuk mulai.`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── Rod commands ──────────────────────────────────────
    b.command('shop', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const shopRods = Object.entries(ROD_SHOP).filter(([,r])=>r.price>0);
            let txt = `🛒 *Toko Rod*\n💰 Saldo: *${fmt(p.money)}*\n\n`;
            shopRods.slice(0,15).forEach(([key,r])=>{
                const owned = p.fishingRods?.has?.(key); const active=key===p.usedFishingRod;
                txt += `${active?'⚡':owned?'✅':'🔒'} *${esc(r.name)}*\n`;
                txt += `   💰 ${fmt(r.price)} | 🍀 ${r.luck} | ⚡ ${r.speed} | 🐟 ×${r.comboFish}\n`;
                if (!owned) txt += `   → \`/buy ${key}\`\n`;
                txt += '\n';
            });
            await rep(ctx,txt);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('buy', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const key = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
            if (!key) return rep(ctx,'❌ Format: `/buy <rod>`\nLihat: /shop');
            const rod = ROD_SHOP[key];
            if (!rod) return rep(ctx,`❌ Rod \`${key}\` tidak ada.`);
            if (p.fishingRods?.has?.(key)) return rep(ctx,`⚠️ Sudah punya *${esc(rod.name)}*.`);
            if (!rod.price||rod.price<=0) return rep(ctx,'❌ Rod ini tidak bisa dibeli. Cek /tokenstore atau /gacha.');
            if ((p.money||0)<rod.price) return rep(ctx,`❌ Uang kurang!\nPerlu: *${fmt(rod.price)}* | Punya: *${fmt(p.money)}*`);
            p.money-=rod.price; p.fishingRods=p.fishingRods||new Map(); p.fishingRods.set(key,{...rod}); p.markModified('fishingRods');
            await p.save();
            await rep(ctx,`✅ *${esc(rod.name)}* dibeli!\n💰 Sisa: *${fmt(p.money)}*\n\n→ \`/equip ${key}\``);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('equip', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const key = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
            if (!key) return rep(ctx,'❌ Format: `/equip <rod>`');
            if (!p.fishingRods?.has?.(key)) return rep(ctx,`❌ Rod \`${key}\` tidak ada di inventorymu.`);
            p.usedFishingRod=key; await p.save();
            await rep(ctx,`✅ *${esc(p.fishingRods.get(key)?.name||key)}* dipasang!`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('listrod', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            if (!p.fishingRods?.size) return rep(ctx,'⚠️ Belum punya rod. /shop!');
            let txt = `🎣 *Rod ${esc(p.username)}* (${p.fishingRods.size})\n\n`;
            for (const [key,rod] of p.fishingRods) {
                const eq=key===p.usedFishingRod;
                txt += `${eq?'⚡ \\[AKTIF\\]':'🔹'} *${esc(rod?.name||key)}*${rod?.enchant?' ✨'+esc(rod.enchant):''}\n`;
                txt += `   Lv.${rod?.level||1}/${rod?.maxLevel||1} | 🍀${(rod?.luck||0)*100|0}% | ⚡${(rod?.speed||0)*100|0}%\n`;
                if (!eq) txt += `   → \`/equip ${key}\`\n`;
                txt+='\n';
            }
            await rep(ctx,txt);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('enchant', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const rod = p.fishingRods?.get?.(p.usedFishingRod);
            if (!rod) return rep(ctx,'⚠️ Tidak ada rod aktif. /equip dulu!');
            rod.enchantCount=rod.enchantCount||0;
            const cost = 50000+rod.enchantCount*50000;
            if ((p.money||0)<cost) return rep(ctx,`💸 Perlu *${fmt(cost)} coins*. Punya: *${fmt(p.money)}*`);
            let roll=Math.random()*100,cum=0,selRar='common';
            for (const [r,{w}] of Object.entries(ENCHANT_POOL)){cum+=w;if(roll<=cum){selRar=r;break;}}
            const opts=ENCHANT_POOL[selRar].list;
            const chosen=opts[Math.floor(Math.random()*opts.length)];
            const old=rod.enchant; rod.enchant=chosen; rod.enchantCount++;
            p.money-=cost; p.fishingRods.set(p.usedFishingRod,rod); p.markModified('fishingRods');
            await p.save();
            const RE2={common:'⚪',rare:'🟢',epic:'🔵',legendary:'💛',mythic:'🟣',godly:'🌈',secret:'⚫'};
            await rep(ctx,`🔮 *Enchant Berhasil!*\n\n🎣 Rod: *${esc(rod.name)}*\n${old?`✨ Lama: *${esc(old)}*\n`:''}`+
                `🌈 Baru: *${esc(chosen)}*\n${RE2[selRar]||'⚪'} Rarity: *${selRar.toUpperCase()}*\n\n💸 Biaya: ${fmt(cost)}\n💰 Saldo: ${fmt(p.money)}`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('rodupgrade', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const rodKey = p.usedFishingRod; const rod=p.fishingRods?.get?.(rodKey);
            if (!rod) return rep(ctx,'⚠️ Tidak ada rod aktif!');
            const cost = Math.floor(1e12*Math.pow(1.5,rod.enchantCount||0));
            const arg = (ctx.message.text.trim().split(/\s+/)[1]||'').toLowerCase();
            if (arg!=='confirm') return rep(ctx,
                `🔧 *Rod Upgrade Permanen*\n━━━━━━━━━━━━━━\n🎣 Rod: *${esc(rod.name)}*\n\n📊 Stats:\n  🍀 Luck: ${((rod.luck||0)*100).toFixed(1)}%\n  ⚡ Speed: ${((rod.speed||0)*100).toFixed(1)}%\n  💰 Sell: ×${(1+(rod.sellMultiplier||0)).toFixed(2)}\n\n💸 Biaya: *${fmt(cost)}*\n📈 Efek: Luck +5%, Speed +2%, Sell +10%\n\nKetik \`/rodupgrade confirm\` untuk upgrade`
            );
            if ((p.money||0)<cost) return rep(ctx,`💸 Butuh *${fmt(cost)}*. Punya *${fmt(p.money)}*.`);
            p.money-=cost;
            rod.luck=(rod.luck||0)+0.05; rod.speed=Math.min((rod.speed||0)+0.02,0.99); rod.sellMultiplier=(rod.sellMultiplier||0)+0.10; rod.enchantCount=(rod.enchantCount||0)+1;
            p.fishingRods.set(rodKey,rod); p.markModified('fishingRods');
            await p.save();
            await rep(ctx,`✅ *Rod Upgraded!*\n\n🎣 ${esc(rod.name)}\n🍀 Luck +5% | ⚡ Speed +2% | 💰 Sell +10%\n💸 Biaya: ${fmt(cost)}\n💰 Saldo: ${fmt(p.money)}`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('skin', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const args = ctx.message.text.trim().split(/\s+/);
            const a1=args[1]?.toLowerCase(), a2=args[2]?.toLowerCase();
            const owned = p.ownedSkins?.length?p.ownedSkins:['default'];
            if (!a1) {
                let txt=`🎨 *Rod Skin Shop*\nAktif: *${SKINS[p.equippedSkin||'default']?.emoji} ${esc(SKINS[p.equippedSkin||'default']?.name)}*\n\n`;
                for(const[k,s]of Object.entries(SKINS)){const isO=owned.includes(k),isA=(p.equippedSkin||'default')===k; txt+=`${isA?'✅':isO?'🔓':'🔒'} ${s.emoji} *${esc(s.name)}* — ${s.price?fmt(s.price)+' coins':s.gacha?'Gacha SSR':s.token?s.token+' tokens':'Gratis'}\n`; if(!isO&&s.price)txt+=`   → \`/skin buy ${k}\`\n`; else if(isO&&!isA)txt+=`   → \`/skin equip ${k}\`\n`; }
                return rep(ctx,txt);
            }
            if (a1==='buy'&&a2){const s=SKINS[a2]; if(!s)return rep(ctx,`❌ Skin "${a2}" tidak ada.`); if(owned.includes(a2))return rep(ctx,`✅ Sudah punya skin *${esc(s.name)}*.`); if(!s.price||s.price<=0)return rep(ctx,'❌ Tidak bisa dibeli langsung.'); if((p.money||0)<s.price)return rep(ctx,`💸 Perlu ${fmt(s.price)}`); p.money-=s.price;p.ownedSkins=[...owned,a2];await p.save();return rep(ctx,`✅ Skin *${s.emoji} ${esc(s.name)}* dibeli!\n→ \`/skin equip ${a2}\``);}
            if (a1==='equip'&&a2){const s=SKINS[a2];if(!s)return rep(ctx,`❌ Skin tidak ada.`);if(!owned.includes(a2))return rep(ctx,'❌ Belum punya skin ini.');p.equippedSkin=a2;await p.save();return rep(ctx,`✅ Skin *${s.emoji} ${esc(s.name)}* aktif!`);}
            rep(ctx,'_/skin | /skin buy <nama> | /skin equip <nama>_');
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /travel ───────────────────────────────────────────
    b.command('travel', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const dest = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
            const unlocked = p.travelFound||[];
            if (!dest) {
                let txt=`🧭 *Daftar Pulau*\n📍 Sekarang: *${esc(ISLANDS[p.currentIsland]?.name||'Mousewood')}*\n\n`;
                for(const[k,isl]of Object.entries(ISLANDS)){const ok=k==='mousewood'||unlocked.includes(k),cur=k===(p.currentIsland||'mousewood'); txt+=`${cur?'📍':ok?'✅':'🔒'} *${esc(isl.name)}*`; if(!cur&&ok)txt+=` — \`/travel ${k}\``; if(!ok&&isl.req)txt+=`\n   🔒 ${fmt(isl.req.money)} + ${isl.req.fish}x mancing`; txt+='\n'; }
                return rep(ctx,txt);
            }
            if (!ISLANDS[dest]) return rep(ctx,`❌ Pulau \`${dest}\` tidak ditemukan.`);
            if ((p.currentIsland||'mousewood')===dest) return rep(ctx,`⚠️ Sudah di *${esc(ISLANDS[dest].name)}*.`);
            const ok=dest==='mousewood'||unlocked.includes(dest);
            if (!ok) { const req=ISLANDS[dest].req; return rep(ctx,`🔒 *${esc(ISLANDS[dest].name)} Terkunci*\n\n💰 ${fmt(req?.money||0)} coins\n🎣 ${req?.fish||0}x mancing\n\nKamu: 💰${fmt(p.money)} | 🎣${p.fishCaught||0}x`); }
            p.currentIsland=dest; await p.save();
            await rep(ctx,`🛶 Berlayar ke *${esc(ISLANDS[dest].name)}*!\n🎣 Ikan khas pulau ini menantimu!`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /top & /season ────────────────────────────────────
    b.command('top', async ctx => {
        try {
            const top = await Player_.find({}).sort({money:-1}).limit(10).lean();
            const medals=['🥇','🥈','🥉'];
            let txt='🏆 *TOP 10 TERKAYA*\n\n';
            top.forEach((pl,i)=>{txt+=`${medals[i]||`${i+1}\\.`} *${esc(pl.username)}* — ${fmt(pl.money)} coins\n`;});
            await rep(ctx,txt);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('season', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const all = await Player_.find({seasonPoints:{$gt:0}}).sort({seasonPoints:-1}).lean();
            const top5=all.slice(0,5);
            const myRank=all.findIndex(x=>String(x._id)===String(p._id))+1;
            const medals=['🥇','🥈','🥉','4️⃣','5️⃣'];
            let txt=`🏆 *Season Ranking*\n\n`;
            top5.forEach((pl,i)=>{txt+=`${medals[i]} *${esc(pl.username)}* — ${fmt(pl.seasonPoints)} pts\n`;});
            txt+=`\n📍 Posisimu: *#${myRank||'?'}* — ${fmt(p.seasonPoints||0)} pts`;
            await rep(ctx,txt);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── /boss (forward ke WA) ─────────────────────────────
    b.command('boss', async ctx => {
        await rep(ctx,'⚔️ *World Boss*\n\nWorld Boss dikelola server WA\\.\n\nCek & serang di WA:\n`.boss` — Info boss\n`.boss attack` — Serang!\n\nBoss aktif = diumumkan di grup WA 🔔');
    });

    // ── /transfer & /player ───────────────────────────────
    b.command('transfer', async ctx => {
        try {
            const p = await needLink(ctx); if(!p) return;
            const args=ctx.message.text.trim().split(/\s+/);
            if(args.length<3) return rep(ctx,'❌ Format: `/transfer <username> <jumlah>`');
            const targetName=args[1].replace('@','');
            const amount=parseAmount(args[2]);
            if(isNaN(amount)||amount<=0) return rep(ctx,'❌ Jumlah tidak valid.');
            if(amount>(p.money||0)) return rep(ctx,`💸 Saldo tidak cukup! Punya: *${fmt(p.money)}*`);
            const target=await Player_.findOne({username:{$regex:new RegExp(`^${targetName}$`,'i')}});
            if(!target) return rep(ctx,`❌ Player *${esc(targetName)}* tidak ditemukan.`);
            if(String(target._id)===String(p._id)) return rep(ctx,'❌ Tidak bisa transfer ke diri sendiri.');
            p.money-=amount; target.money+=amount;
            await p.save(); await target.save();
            if(target.isVerifiedTelegram&&target.telegramId&&bot){try{await bot.telegram.sendMessage(target.telegramId,`💸 Dapat *${fmt(amount)} coins* dari *${esc(p.username)}*\\!\nSaldo: *${fmt(target.money)}*`,{parse_mode:'Markdown'});}catch(_){}}
            await rep(ctx,`✅ Transfer *${fmt(amount)} coins* ke *${esc(target.username)}*!\n💰 Saldo: *${fmt(p.money)}*`);
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    b.command('player', async ctx => {
        try {
            const p=await needLink(ctx); if(!p) return;
            const name=ctx.message.text.trim().split(/\s+/)[1]?.replace('@','');
            if(!name) return rep(ctx,'❌ Format: `/player <username>`');
            const t=await Player_.findOne({$or:[{username:{$regex:new RegExp(`^${name}$`,'i')}},{id:parseInt(name)||0}]}).lean();
            if(!t) return rep(ctx,`❌ *${esc(name)}* tidak ditemukan.`);
            await rep(ctx,
                `👤 *${esc(t.username)}* \\[ID: ${t.id}\\]\n\n⭐ Level: *${t.level}*\n💰 Saldo: *${fmt(t.money)}*\n🐟 Mancing: *${t.fishCaught||0}x*\n🏝️ Pulau: *${esc(ISLANDS[t.currentIsland]?.name||'Mousewood')}*\n🏆 Ach: *${t.achievements?.length||0}*\n👑 Prestige: *${t.prestige||0}*`
            );
        } catch (e) { await rep(ctx,'❌ Terjadi kesalahan.'); }
    });

    // ── Friend commands ───────────────────────────────────
    const friendCmds = {
        addfriend:     async (ctx,p,name)=>{ const t=await Player_.findOne({username:{$regex:new RegExp(`^${name}$`,'i')}}); if(!t)return rep(ctx,`❌ *${esc(name)}* tidak ditemukan.`); if(String(t._id)===String(p._id))return rep(ctx,'❌ Tidak bisa tambah diri sendiri.'); if((p.friends||[]).some(f=>String(f)===String(t._id)))return rep(ctx,`⚠️ *${esc(t.username)}* sudah temanmu.`); t.pendingFriends=[...(t.pendingFriends||[]),p._id];await t.save(); rep(ctx,`✅ Request dikirim ke *${esc(t.username)}*!`); },
        acceptfriend:  async (ctx,p,name)=>{ const s=await Player_.findOne({username:{$regex:new RegExp(`^${name}$`,'i')}}); if(!s)return rep(ctx,`❌ *${esc(name)}* tidak ditemukan.`); if(!(p.pendingFriends||[]).some(f=>String(f)===String(s._id)))return rep(ctx,`⚠️ Tidak ada request dari *${esc(s.username)}*.`); p.pendingFriends=(p.pendingFriends||[]).filter(f=>String(f)!==String(s._id));p.friends=[...new Set([...(p.friends||[]).map(String),String(s._id)])];s.friends=[...new Set([...(s.friends||[]).map(String),String(p._id)])];await p.save();await s.save(); rep(ctx,`✅ *${esc(s.username)}* sekarang temanmu!`); },
        declinefriend: async (ctx,p,name)=>{ const s=await Player_.findOne({username:{$regex:new RegExp(`^${name}$`,'i')}}); if(!s)return rep(ctx,`❌ *${esc(name)}* tidak ditemukan.`); p.pendingFriends=(p.pendingFriends||[]).filter(f=>String(f)!==String(s._id));await p.save(); rep(ctx,`❌ Request dari *${esc(s.username)}* ditolak.`); },
        delfriend:     async (ctx,p,name)=>{ const t=await Player_.findOne({username:{$regex:new RegExp(`^${name}$`,'i')}}); if(!t)return rep(ctx,`❌ *${esc(name)}* tidak ditemukan.`); p.friends=(p.friends||[]).filter(f=>String(f)!==String(t._id));t.friends=(t.friends||[]).filter(f=>String(f)!==String(p._id));await p.save();await t.save(); rep(ctx,`✅ *${esc(t.username)}* dihapus dari teman.`); },
    };
    for (const [cmd,fn] of Object.entries(friendCmds)) {
        b.command(cmd, async ctx=>{ try{ const p=await needLink(ctx);if(!p)return; const name=ctx.message.text.trim().split(/\s+/)[1]?.replace('@',''); if(!name)return rep(ctx,`❌ Format: \`/${cmd} <username>\``); await fn(ctx,p,name); }catch(e){await rep(ctx,'❌ Terjadi kesalahan.'); }});
    }

    b.command('requestfriends', async ctx=>{ try{ const p=await needLink(ctx);if(!p)return; const pend=p.pendingFriends||[]; if(!pend.length)return rep(ctx,'📭 Tidak ada request pertemanan.'); const senders=await Player_.find({_id:{$in:pend}}).lean(); let txt=`👥 *Request Pertemanan (${senders.length})*\n\n`; senders.forEach((s,i)=>{txt+=`${i+1}\\. *${esc(s.username)}*\n   \`/acceptfriend ${s.username}\` | \`/declinefriend ${s.username}\`\n`;}); await rep(ctx,txt); }catch(e){await rep(ctx,'❌ Terjadi kesalahan.')} });
    b.command('listfriend', async ctx=>{ try{ const p=await needLink(ctx);if(!p)return; if(!(p.friends||[]).length)return rep(ctx,'👥 Belum punya teman. `/addfriend <username>`'); const friends=await Player_.find({_id:{$in:p.friends}}).lean(); let txt=`👥 *Teman ${esc(p.username)}* (${friends.length})\n\n`; friends.forEach((f,i)=>{txt+=`${i+1}\\. *${esc(f.username)}* — 💰${fmt(f.money)} | Lv\\.${f.level}\n`;}); await rep(ctx,txt); }catch(e){await rep(ctx,'❌ Terjadi kesalahan.')} });
}

// ═══════════════════════════════════════════════════════════
//   INIT
// ═══════════════════════════════════════════════════════════
function initTelegram(cfg, Player, TelegramSession, waClientInstance = null) {
    if (bot) return bot;
    Player_   = Player;
    Session_  = TelegramSession;
    waClient_ = waClientInstance;

    const enabled = cfg?.telegram?.enabled === true;
    const token   = (cfg?.telegram?.botToken || '').trim();

    if (!enabled) { console.log('  \x1b[33m[TG]\x1b[0m ℹ️  Nonaktif (enabled=false di config.js)'); return null; }
    if (!token || token.includes('ISI_TOKEN') || token.length < 10) {
        console.log('  \x1b[33m[TG]\x1b[0m ⚠️  botToken belum diisi di config.js'); return null;
    }

    try {
        bot = new Telegraf(token);
        registerAll(bot);
        let retries = 0;
        function doLaunch() {
            bot.launch({ dropPendingUpdates:true, allowedUpdates:['message','callback_query'] })
            .then(async () => {
                isReady=true; retries=0;
                try { const me=await bot.telegram.getMe(); console.log(`  \x1b[32m[TG]\x1b[0m ✅ Bot Telegram aktif! @${me.username}`); } catch(_){}
            })
            .catch(err => {
                isReady=false; retries++;
                const msg=err.message||'';
                if (msg.includes('401')||msg.includes('Unauthorized')){ console.error('  \x1b[31m[TG]\x1b[0m ❌ Token tidak valid!'); bot=null; return; }
                if (msg.includes('409')||msg.includes('Conflict')){ console.error('  \x1b[33m[TG]\x1b[0m ⚠️  Conflict — retry 30s...'); setTimeout(doLaunch,30000); return; }
                if (retries<=10){ const w=Math.min(retries*5000,60000); console.error(`  \x1b[31m[TG]\x1b[0m ❌ Launch gagal #${retries}: ${msg.slice(0,60)}`); setTimeout(doLaunch,w); }
                else { console.error('  \x1b[31m[TG]\x1b[0m ❌ Menyerah setelah 10x retry.'); bot=null; isReady=false; }
            });
        }
        doLaunch();
        process.removeAllListeners('SIGINT'); process.removeAllListeners('SIGTERM');
        process.once('SIGINT',  ()=>{ if(bot){bot.stop('SIGINT'); bot=null;} });
        process.once('SIGTERM', ()=>{ if(bot){bot.stop('SIGTERM');bot=null;} });
        return bot;
    } catch (e) { console.error('  \x1b[31m[TG]\x1b[0m ❌ Init error:', e.message); bot=null; return null; }
}

async function notifyTelegram(tgId, message) {
    if (!bot||!isReady||!tgId) return;
    try {
        await bot.telegram.sendMessage(String(tgId), message, { parse_mode:'Markdown', disable_web_page_preview:true });
    } catch (e) {
        const msg=e.message||'';
        if (['blocked','not found','chat not found','deactivated','kicked'].some(s=>msg.toLowerCase().includes(s))) return;
        if (msg.includes('parse')||msg.includes('entities')) {
            try { await bot.telegram.sendMessage(String(tgId), message.replace(/[*_`\[\]\\]/g,''), {disable_web_page_preview:true}); } catch(_){}
        }
    }
}

module.exports = { initTelegram, notifyTelegram, getTgBot:()=>bot };
