'use strict';

const chalk = require('chalk');
const fs    = require('fs');
const path  = require('path');

let attempts = 0;
const MAX_ATTEMPTS = 25;
const MAX_WAIT_MS  = 90_000;

// ── Status line: tulis SEKALI, tidak repeat ──────────────────
// Tidak pakai setInterval sama sekali — cukup satu log per state change
let _onlineLogged = false;

exports.konek = async ({ client, update, clientstart, DisconnectReason, Boom }) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        console.log(chalk.yellow('\n📱 QR muncul — scan atau set terminal:true di config untuk pairing code\n'));
    }

    if (connection === 'connecting') {
        _onlineLogged = false;
        console.log(chalk.cyan('\n⏳ Menghubungkan ke WhatsApp...'));
        return;
    }

    if (connection === 'open') {
        attempts = 0;
        try { await client.newsletterFollow('120363422841562761@newsletter'); } catch (_) {}

        // Log SEKALI saja saat pertama online — tidak ada setInterval, tidak ada spam
        if (!_onlineLogged) {
            _onlineLogged = true;
            console.log(chalk.green('\n✅ WhatsApp Bot Online!'));
            console.log(chalk.cyan('🐟 Fisch Bot — Aktif & siap menerima pesan!\n'));
        }
        return;
    }

    if (connection === 'close') {
        _onlineLogged = false;

        let code = 500, msg = '';
        try {
            code = new Boom(lastDisconnect?.error)?.output?.statusCode ?? 500;
            msg  = lastDisconnect?.error?.message ?? '';
        } catch (_) {}

        console.log(chalk.red(`\n❌ [DISCONNECT] Code: ${code} | ${msg || '(no message)'}`));

        const reconnect = (baseMs = 4000) => {
            attempts++;
            if (attempts > MAX_ATTEMPTS) {
                console.log(chalk.red(`\n🚫 Gagal reconnect ${MAX_ATTEMPTS}x berturut-turut. Restart manual.`));
                return process.exit(1);
            }
            const wait = Math.min(baseMs * Math.pow(1.5, attempts - 1), MAX_WAIT_MS);
            console.log(chalk.yellow(`🔄 Reconnect #${attempts}/${MAX_ATTEMPTS} dalam ${(wait / 1000).toFixed(0)}s...`));
            setTimeout(() => {
                try { clientstart(); } catch (e) { console.error('[reconnect]', e.message); }
            }, wait);
        };

        const delSession = () => {
            const d = path.resolve('./sessions');
            if (fs.existsSync(d)) {
                fs.rmSync(d, { recursive: true, force: true });
                console.log(chalk.cyan('🗑️  Session dihapus'));
            }
        };

        switch (code) {
            case DisconnectReason.badSession:
                delSession(); attempts = 0; reconnect(2000); break;
            case DisconnectReason.connectionClosed:
                reconnect(3000); break;
            case DisconnectReason.connectionLost:
                reconnect(5000); break;
            case DisconnectReason.connectionReplaced:
                console.log(chalk.red('⚠️  Session digantikan perangkat lain.')); process.exit(0); break;
            case DisconnectReason.loggedOut:
                console.log(chalk.red('🚪 Logged out.')); delSession(); process.exit(0); break;
            case DisconnectReason.restartRequired:
                attempts = 0; reconnect(1500); break;
            case DisconnectReason.timedOut:
                reconnect(8000); break;
            case 401:
                console.log(chalk.red('🔐 Session tidak valid / expired.'));
                delSession(); attempts = 0; reconnect(3000); break;
            case 403:
                console.log(chalk.red('🚫 Nomor mungkin dibanned WhatsApp.')); process.exit(1); break;
            case 408: reconnect(8000); break;
            case 428: reconnect(5000); break;
            case 500: reconnect(15000); break;
            case 503: reconnect(15000); break;
            case 515: reconnect(10000); break;
            default:
                if (msg.includes('not-acceptable') || code === 406) {
                    console.log(chalk.yellow('⚠️  not-acceptable — reconnect cepat...'));
                    reconnect(2000);
                } else if (msg.includes('Connection') || msg.includes('socket') ||
                           msg.includes('ECONNRESET') || msg.includes('stream')) {
                    reconnect(6000);
                } else if (msg.includes('rate') || msg.includes('limit')) {
                    reconnect(30_000);
                } else {
                    reconnect(5000);
                }
        }
    }
};
          
