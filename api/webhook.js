const crypto = require('crypto');

export default async function handler(req, res) {
  // Only allow POST requests (which is what Razorpay sends)
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Your Vercel environment variables
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  
  // 🚨 CRITICAL: Make sure you add this variable in your Vercel Dashboard!
  const adminChatId = process.env.ADMIN_CHAT_ID; 

  // Razorpay sends a signature in the headers to prove it's really them
  const signature = req.headers['x-razorpay-signature'];

  try {
    // 1. Validate the signature (Stop Hackers/Fakes)
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.log("❌ Invalid signature. Hacker attack blocked.");
      return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }

    // --- 🟢 SIGNATURE VALID: EXTRACT THE DATA ---
    const event = req.body.event; 
    
    // Extract the payment details
    const paymentEntity = req.body.payload.payment ? req.body.payload.payment.entity : null;
    
    // Safely extract the notes (this is where we hid the order_id and telegram_id)
    const notes = paymentEntity?.notes || req.body.payload.payment_link?.entity?.notes || {};
    
    const telegramId = notes.telegram_id;
    const orderId = notes.order_id; // We need this for the Python bot!

    console.log(`✅ Webhook Event Received: ${event} for Order: ${orderId}`);

    // --- 🔀 EVENT SWITCHBOARD ---
    switch (event) {
      
      case 'payment_link.paid':
        console.log(`✅ Success for Order: ${orderId}`);
        // Send the hidden trigger to the Python Bot
        if (orderId && adminChatId) {
          await sendTelegramMessage(adminChatId, `/rzp_webhook ${orderId} paid`);
        }
        break;

      case 'payment.swailed':
        // Tell the bot it failed (optional, but good for logging)
        if (orderId && adminChatId) {
           await sendTelegramMessage(adminChatId, `/rzp_webhook ${orderId} failed`);
        }
        // Still send a direct message to the user so they know what happened
        if (telegramId) {
          await sendTelegramMessage(
            telegramId, 
            `❌ *Payment Failed*\n\n*Reason:* ${paymentEntity?.error_description || 'Bank issue'}\n\nDon't worry, no money was deducted. Please click the payment link again to retry, or try a different UPI app.`
          );
        }
        break;
        case 'payment.failed':
        // 1. Tell the Python bot it failed
        if (orderId && adminChatId) {
           await sendTelegramMessage(adminChatId, `/rzp_webhook ${orderId} failed`);
        }
        // 2. Tell the user it failed
        if (telegramId) {
          await sendTelegramMessage(
            telegramId, 
            `❌ *Payment Failed*\n\nYour payment for Order \`${orderId}\` could not be processed. Please click the payment link again to retry, or use a different UPI app.`
          );
        }
        break;

      case 'payment.authorized':
        if (telegramId) {
          await sendTelegramMessage(
            telegramId, 
            `⏳ *Payment Pending...*\nWe are waiting for final confirmation from your bank for Order \`${orderId}\`. Please wait a moment.`
          );
        }
        break;

      case 'payment.dispute.created':
        // If a user tries to commit fraud (chargeback), alert YOU immediately.
        if (adminChatId) {
          await sendTelegramMessage(
            adminChatId, 
            `🚨 *FRAUD / DISPUTE ALERT*\n\n*Order ID:* \`${orderId}\`\n*Telegram ID:* \`${telegramId}\`\n\nThe user raised a dispute with their bank. Please ban this user and check your Razorpay dashboard.`
          );
        }
        break;

      default:
        console.log(`Unhandled event type: ${event}`);
    }

    // 3. Always tell Razorpay "OK" so they know we got the message
    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ status: 'error', message: 'Server Error' });
  }
}

// --- Helper Function: Send Messages via Telegram Bot API ---
async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error("❌ TELEGRAM_BOT_TOKEN is missing in Vercel Settings!");
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}
