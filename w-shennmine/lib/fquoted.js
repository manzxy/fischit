'use strict';

/**
 * fquoted - Forward quoted message helper
 * Membuat object contextInfo untuk forward/quote pesan
 */

const fquoted = (m) => {
    if (!m) return {};
    
    const key = m.key || m.quoted?.key || {};
    const message = m.message || m.quoted?.message || {};
    const sender = m.sender || m.quoted?.sender || key.participant || key.remoteJid || '';
    
    return {
        contextInfo: {
            quotedMessage: message,
            stanzaId: key.id || '',
            participant: sender,
            remoteJid: key.remoteJid || ''
        }
    };
};

module.exports = { fquoted };
