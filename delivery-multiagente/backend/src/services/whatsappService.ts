import https from 'https';

export async function sendWhatsAppMessage(phone: string, message: string): Promise<void> {
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) {
    console.warn('[WhatsApp] CALLMEBOT_API_KEY no configurada — notificación omitida');
    return;
  }

  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      res.resume();
      console.log(`[WhatsApp] Mensaje enviado a ${phone} — HTTP ${res.statusCode}`);
      resolve();
    }).on('error', (err) => {
      console.error('[WhatsApp] Error al enviar:', err.message);
      resolve();
    });
  });
}
