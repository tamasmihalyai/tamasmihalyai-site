// Stripe payment -> deliver the Humanize Kit by email.
//
// Flow: Stripe sends a `checkout.session.completed` webhook here. We DON'T trust the
// request body for anything except the event id: we re-fetch the event from Stripe's
// API with our key, so a forged request can't trigger a delivery. If it's a real, paid
// checkout, we email the buyer the download link via Resend.
//
// Dependency-free: uses global fetch (Node 18+; this project runs Node 24.x).
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY  - a restricted key with READ access to "Events"
//   RESEND_API_KEY     - Resend API key
//   DOWNLOAD_URL       - the hosted zip link (e.g. a Google Drive "anyone with link" URL)
//   DELIVERY_FROM      - optional, the From address. Defaults to Resend's test sender,
//                        which only delivers to your own Resend account email until you
//                        verify tamasmihaly.ai in Resend.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const body =
      req.body && typeof req.body === 'object' ? req.body : JSON.parse(await readRaw(req));
    const eventId = body && body.id;
    const eventType = body && body.type;

    // Acknowledge anything that isn't a completed checkout so Stripe stops retrying.
    if (eventType !== 'checkout.session.completed') {
      res.status(200).json({ received: true, ignored: eventType || 'unknown' });
      return;
    }

    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const DOWNLOAD_URL = process.env.DOWNLOAD_URL;
    // Sender set in code (controlled here, not via a Vercel env var).
    // hello@thrivingcolibri.ai is the Resend-verified domain; replies land in that inbox natively.
    const FROM = 'Tamas Mihaly 🧭 <hello@thrivingcolibri.ai>';
    const REPLY_TO = process.env.DELIVERY_REPLY_TO; // optional override

    if (!STRIPE_KEY || !RESEND_KEY || !DOWNLOAD_URL) {
      console.error('Missing env vars', {
        stripe: !!STRIPE_KEY,
        resend: !!RESEND_KEY,
        download: !!DOWNLOAD_URL,
      });
      res.status(500).send('Server not configured');
      return;
    }

    // Re-fetch the event from Stripe to confirm it's genuine.
    const evResp = await fetch(`https://api.stripe.com/v1/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    });
    if (!evResp.ok) {
      console.error('Stripe verify failed', eventId, evResp.status);
      res.status(400).send('Could not verify event');
      return;
    }

    const event = await evResp.json();
    const session = event && event.data && event.data.object;
    if (!session || session.payment_status !== 'paid') {
      res.status(200).json({ received: true, note: 'not a paid session' });
      return;
    }

    const email = session.customer_details && session.customer_details.email;
    if (!email) {
      console.error('No customer email on session', session.id);
      res.status(200).json({ received: true, note: 'no email on session' });
      return;
    }

    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        subject: 'Your Humanize Kit is here',
        html: deliveryEmail(DOWNLOAD_URL),
        text: deliveryEmailText(DOWNLOAD_URL),
      }),
    });

    if (!sendResp.ok) {
      const detail = await sendResp.text();
      console.error('Resend failed', sendResp.status, detail);
      res.status(500).send('Email send failed');
      return;
    }

    console.log('Delivered Humanize Kit to', email);
    res.status(200).json({ received: true, delivered: true });
  } catch (err) {
    console.error('Webhook error', err);
    res.status(500).send('Webhook error');
  }
};

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data || '{}'));
    req.on('error', reject);
  });
}

function deliveryEmail(downloadUrl) {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f5f7fb;">Your download's inside, plus a 2-minute setup so it writes like you.</div>
<div style="display:none;max-height:0;overflow:hidden;">&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f7fb;margin:0;padding:0;width:100%;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e6e9ef;border-radius:14px;">
        <tr>
          <td style="background-color:#161b26;border-radius:14px 14px 0 0;padding:18px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:10px;">
                  <img src="https://tamasmihaly.ai/tamas-mihaly-profile.png" width="36" height="36" alt="Tamas Mihaly" style="display:block;width:36px;height:36px;border-radius:50%;border:1px solid #00bcd4;">
                </td>
                <td style="font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">TAMAS MIHALY <span style="color:#00bcd4;">AI</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a202c;">
            <p style="margin:0 0 16px;">Hey,</p>
            <p style="margin:0 0 24px;">Thanks for getting the Humanize Kit. Here it is.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" bgcolor="#00bcd4" style="border-radius:10px;">
                  <a href="${downloadUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;color:#04222a;text-decoration:none;">Download the Humanize Kit</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 20px;">Open the manual first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then capturing your voice. The short video does the same if you'd rather watch.</p>
            <p style="margin:0 0 12px;font-weight:bold;">Two things worth knowing</p>
            <p style="margin:0 0 12px;"><span style="color:#00bcd4;font-weight:bold;">&bull;</span>&nbsp; Capture your voice first. Give it a few things you actually wrote. That's what makes the rewrite sound like you.</p>
            <p style="margin:0 0 24px;"><span style="color:#00bcd4;font-weight:bold;">&bull;</span>&nbsp; The rewrite works on any plan. The score runs a small script, so that part needs a paid Claude or ChatGPT.</p>
            <p style="margin:0 0 20px;">You get every update for life, so when I improve the kit you get the new version.</p>
            <p style="margin:0 0 24px;">If anything's not working, just reply to this email. It comes straight to me.</p>
            <p style="margin:0;">Tamas</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #eef1f6;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9aa3b2;">Thriving Colibri Ltd &middot; You're receiving this because you bought the Humanize Kit.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function deliveryEmailText(downloadUrl) {
  return `Hey,

Thanks for getting the Humanize Kit. Here it is.

Download the Humanize Kit: ${downloadUrl}

Open the manual first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then capturing your voice. The short video does the same if you'd rather watch.

Two things worth knowing
- Capture your voice first. Give it a few things you actually wrote. That's what makes the rewrite sound like you.
- The rewrite works on any plan. The score runs a small script, so that part needs a paid Claude or ChatGPT.

You get every update for life, so when I improve the kit you get the new version.

If anything's not working, just reply to this email. It comes straight to me.

Tamas`;
}
