'use strict';
/**
 * FISCH BOT — myfunction.js
 * Helper functions untuk WhatsApp bot
 */

const {
    extractMessageContent, jidNormalizedUser, proto,
    delay, getContentType, areJidsSameUser, generateWAMessage
} = require('@whiskeysockets/baileys');

const chalk  = require('chalk');
const fs     = require('fs');
const crypto = require('crypto');
const axios  = require('axios');
const moment = require('moment-timezone');
const util   = require('util');
const Jimp   = require('jimp');

// ── Time ──────────────────────────────────────────
exports.unixTimestampSeconds = (date = new Date()) => Math.floor(date.getTime() / 1000);

exports.sleep = (ms) => new Promise(r => setTimeout(r, ms));

exports.runtime = (seconds) => {
    seconds = Number(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [
        d > 0 ? `${d} hari` : '',
        h > 0 ? `${h} jam` : '',
        m > 0 ? `${m} menit` : '',
        s > 0 ? `${s} detik` : ''
    ].filter(Boolean).join(', ') || '0 detik';
};

exports.clockString = (ms) => {
    if (isNaN(ms)) return '--:--:--';
    return [Math.floor(ms/3600000), Math.floor(ms/60000)%60, Math.floor(ms/1000)%60]
        .map(v => String(v).padStart(2, '0')).join(':');
};

exports.getTime = (format, date) => {
    if (date) return moment(date).locale('id').format(format);
    return moment.tz('Asia/Jakarta').locale('id').format(format);
};

exports.formatDate = (n, locale = 'id') =>
    new Date(n).toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long',
        year: 'numeric', hour: 'numeric', minute: 'numeric'
    });

// ── HTTP ──────────────────────────────────────────
exports.getBuffer = async (url, opts = {}) => {
    const res = await axios({ method: 'get', url, responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0' }, ...opts });
    return res.data;
};

exports.fetchJson = async (url, opts = {}) => {
    const res = await axios({ method: 'GET', url,
        headers: { 'User-Agent': 'Mozilla/5.0' }, ...opts });
    return res.data;
};

exports.isUrl = (url) => /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b/.test(url);

// ── Size ──────────────────────────────────────────
exports.formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

// ── String ────────────────────────────────────────
exports.getRandom = (ext) => `${Math.floor(Math.random() * 10000)}${ext}`;

exports.parseMention = (text = '') =>
    [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net');

exports.getGroupAdmins = (participants) =>
    participants.filter(p => p.admin === 'superadmin' || p.admin === 'admin').map(p => p.id);

exports.jsonformat = (obj) => JSON.stringify(obj, null, 2);

// ── Image ─────────────────────────────────────────
exports.resize = async (image, width, height) => {
    const img = await Jimp.read(image);
    return img.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
};

exports.reSize = async (buffer, x, z) => {
    const buff = await Jimp.read(buffer);
    return buff.resize(x, z).getBufferAsync(Jimp.MIME_JPEG);
};

exports.generateProfilePicture = async (buffer) => {
    const img = await Jimp.read(buffer);
    const min = Math.min(img.getWidth(), img.getHeight());
    const cropped = img.crop(0, 0, min, min);
    return {
        img:     await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG),
        preview: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG)
    };
};

// ── Serialize Message ─────────────────────────────
exports.smsg = async (client, m, store) => {
    if (!m) return m;
    const M = proto.WebMessageInfo;
    if (m.key) {
        m.id      = m.key.id;
        m.from    = m.key.remoteJid?.startsWith('status')
            ? jidNormalizedUser(m.key?.participant || m.participant)
            : jidNormalizedUser(m.key.remoteJid);
        m.isBaileys = m.id?.startsWith('BAE5') && m.id.length === 16;
        m.chat    = m.key.remoteJid;
        m.fromMe  = m.key.fromMe;
        m.isGroup = m.chat?.endsWith('@g.us');
        m.sender  = client.decodeJid(m.fromMe && client.user.id || m.participant || m.key.participant || m.chat || '');
        if (m.isGroup) m.participant = client.decodeJid(m.key.participant) || '';
    }
    if (m.message) {
        m.mtype = getContentType(m.message);
        m.msg   = m.mtype === 'viewOnceMessage'
            ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
            : m.message[m.mtype];
        m.body  = m.message?.conversation
            || m.message?.extendedTextMessage?.text
            || m.msg?.caption
            || m.msg?.text
            || (m.mtype === 'listResponseMessage' ? m.msg?.singleSelectReply?.selectedRowId : '')
            || (m.mtype === 'buttonsResponseMessage' ? m.msg?.selectedButtonId : '')
            || (m.mtype === 'templateButtonReplyMessage' ? m.msg?.selectedId : '')
            || (m.mtype === 'viewOnceMessage' ? m.msg?.caption : '')
            || m.text || '';

        const quotedRaw = m.msg?.contextInfo?.quotedMessage;
        m.mentionedJid  = m.msg?.contextInfo?.mentionedJid || [];

        if (quotedRaw) {
            let type  = getContentType(quotedRaw);
            let qMsg  = quotedRaw[type];
            if (['productMessage'].includes(type)) {
                type = getContentType(qMsg);
                qMsg = qMsg[type];
            }
            if (typeof qMsg === 'string') qMsg = { text: qMsg };
            m.quoted       = qMsg;
            m.quoted.key   = {
                remoteJid:   m.msg?.contextInfo?.remoteJid || m.from,
                participant: jidNormalizedUser(m.msg?.contextInfo?.participant),
                fromMe:      areJidsSameUser(jidNormalizedUser(m.msg?.contextInfo?.participant), jidNormalizedUser(client?.user?.id)),
                id:          m.msg?.contextInfo?.stanzaId
            };
            m.quoted.mtype  = type;
            m.quoted.from   = /g\.us|status/.test(m.msg?.contextInfo?.remoteJid) ? m.quoted.key.participant : m.quoted.key.remoteJid;
            m.quoted.id     = m.msg?.contextInfo?.stanzaId;
            m.quoted.chat   = m.msg?.contextInfo?.remoteJid || m.chat;
            m.quoted.sender = client.decodeJid(m.msg?.contextInfo?.participant);
            m.quoted.fromMe = m.quoted.sender === (client.user && client.user.id);
            m.quoted.text   = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
            m.quoted.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];

            const vM = m.quoted.fakeObj = M.fromObject({
                key: { remoteJid: m.quoted.chat, fromMe: m.quoted.fromMe, id: m.quoted.id },
                message: quotedRaw,
                ...(m.isGroup ? { participant: m.quoted.sender } : {})
            });
            m.quoted.delete      = () => client.sendMessage(m.quoted.chat, { delete: vM.key });
            m.quoted.copyNForward = (jid, force = false, opts = {}) => client.copyNForward(jid, vM, force, opts);
            m.quoted.download    = () => client.downloadMediaMessage(m.quoted);
        } else {
            m.quoted = null;
        }
    }
    if (m.msg?.url) m.download = () => client.downloadMediaMessage(m.msg);
    m.text  = m.message?.conversation || m.message?.extendedTextMessage?.text || m.msg?.text || m.msg?.caption || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || '';
    m.reply = (text, chatId = m.chat, opts = {}) => {
        if (Buffer.isBuffer(text)) {
            return client.sendMessage(chatId, { document: text, mimetype: 'application/octet-stream', ...opts }, { quoted: m });
        }
        return client.sendMessage(chatId, { text, ...opts }, { quoted: m });
    };
    m.copy  = () => exports.smsg(client, M.fromObject(M.toObject(m)));
    m.copyNForward = (jid = m.chat, force = false, opts = {}) => client.copyNForward(jid, m, force, opts);
    return m;
};


// ── Extra helpers ─────────────────────────────────
exports.fetchBuffer = exports.getBuffer;

exports.bytesToSize = (bytes) => {
    if (!bytes) return '0 B';
    const sizes = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

exports.pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Hot-reload
let _file = require.resolve(__filename);
fs.watchFile(_file, () => {
    fs.unwatchFile(_file);
    delete require.cache[_file];
    console.log('[myfunction] updated!');
});
