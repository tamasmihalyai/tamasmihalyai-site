// Stripe payment -> deliver the bought product (Humanize Kit or The Skill System) by email.
//
// Flow: Stripe sends a `checkout.session.completed` webhook here. We DON'T trust the
// request body for anything except the event id: we re-fetch the event from Stripe's
// API with our key, so a forged request can't trigger a delivery. If it's a real, paid
// checkout, we work out which product was bought and email the buyer the download via Resend.
//
// Product routing: by the line-item product NAME (stable across price changes), with the
// £99 amount as a secondary signal for The Skill System. Anything else falls back to the
// Humanize Kit, so the original single-product behaviour is preserved unchanged.
//
// Dependency-free: uses global fetch (Node 18+; this project runs Node 24.x).
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY  - a restricted key with READ access to "Events" and "Checkout Sessions"
//   RESEND_API_KEY     - Resend API key
//   DELIVERY_REPLY_TO  - optional reply-to override

const PRODUCTS = {
  humanizeKit: {
    label: 'Humanize Kit',
    // Google Drive direct-download (trusted domain) while tamasmihaly.ai builds Safe Browsing reputation.
    downloadUrl: 'https://drive.google.com/uc?export=download&id=1r6aNpyc1iBZtmAglXorkV8c5JjqLunoT',
    subject: 'Your Humanize Kit is here',
    html: humanizeKitEmail,
    text: humanizeKitEmailText,
  },
  skillSystem: {
    label: 'Skill System',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=1DHkz-lQeMDuWBt1-GWD2y0WFU0C4JXnB',
    subject: 'Your Skill System is here',
    html: skillSystemEmail,
    text: skillSystemEmailText,
  },
};

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
    // Sender set in code (controlled here, not via a Vercel env var).
    // hello@thrivingcolibri.ai is the Resend-verified domain; replies land in that inbox natively.
    const FROM = 'Tamas Mihaly 🧭 <hello@thrivingcolibri.ai>';
    const REPLY_TO = process.env.DELIVERY_REPLY_TO; // optional override

    if (!STRIPE_KEY || !RESEND_KEY) {
      console.error('Missing env vars', { stripe: !!STRIPE_KEY, resend: !!RESEND_KEY });
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

    // Work out which product was bought. Route by the line-item product name (stable across
    // price changes); fall back to the £99 amount for The Skill System, else the Humanize Kit.
    let productName = '';
    try {
      const liResp = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=1`,
        { headers: { Authorization: `Bearer ${STRIPE_KEY}` } }
      );
      if (liResp.ok) {
        const li = await liResp.json();
        productName = (li.data && li.data[0] && li.data[0].description) || '';
      } else {
        console.error('line_items fetch failed', liResp.status);
      }
    } catch (e) {
      console.error('line_items fetch error', e);
    }

    const isSkillSystem = /skills?\s*system/i.test(productName) || session.amount_total === 9900;
    const product = isSkillSystem ? PRODUCTS.skillSystem : PRODUCTS.humanizeKit;

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
        subject: product.subject,
        html: product.html(product.downloadUrl),
        text: product.text(product.downloadUrl),
      }),
    });

    if (!sendResp.ok) {
      const detail = await sendResp.text();
      console.error('Resend failed', sendResp.status, detail);
      res.status(500).send('Email send failed');
      return;
    }

    console.log(
      `Delivered ${product.label} to ${email} (product: "${productName}", amount: ${session.amount_total})`
    );
    res.status(200).json({ received: true, delivered: true, product: product.label });
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

function humanizeKitEmail(downloadUrl) {
  // Hidden preheader = the inbox/notification preview text. The padding AFTER the sentence
  // fills the snippet on long-preview clients (iOS Mail + push notifications) so the visible
  // body (e.g. the "TAMAS MIHALY AI" header) can't leak into the preview. Zero-width spaces
  // alone don't count; &zwnj;&nbsp; pairs do. (See the email-preheader rule in global CLAUDE.md.)
  const preheaderPad = '&zwnj;&nbsp;'.repeat(120);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f5f7fb;">Your download's inside, plus a quick 2-minute setup so everything you write sounds like you.${preheaderPad}</div>
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
            <p style="margin:0 0 20px;">Open the guide first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then capturing your voice.</p>
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

function humanizeKitEmailText(downloadUrl) {
  return `Hey,

Thanks for getting the Humanize Kit. Here it is.

Download the Humanize Kit: ${downloadUrl}

Open the guide first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then capturing your voice.

Two things worth knowing
- Capture your voice first. Give it a few things you actually wrote. That's what makes the rewrite sound like you.
- The rewrite works on any plan. The score runs a small script, so that part needs a paid Claude or ChatGPT.

You get every update for life, so when I improve the kit you get the new version.

If anything's not working, just reply to this email. It comes straight to me.

Tamas`;
}

function skillSystemEmail(downloadUrl) {
  // Hidden preheader (see note in humanizeKitEmail). One clean sentence, then padding so the
  // visible header can't leak into the mobile/lock-screen preview.
  const preheaderPad = '&zwnj;&nbsp;'.repeat(120);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f5f7fb;">Your download's inside, plus the one thing to set up first so the whole system writes like you.${preheaderPad}</div>
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
            <p style="margin:0 0 24px;">Thanks for getting the Skill System. Here it is.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" bgcolor="#00bcd4" style="border-radius:10px;">
                  <a href="${downloadUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;color:#04222a;text-decoration:none;">Download the Skill System</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 20px;">Open the guide first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then running your first piece through the chain.</p>
            <p style="margin:0 0 12px;font-weight:bold;">Where to start</p>
            <p style="margin:0 0 12px;"><span style="color:#00bcd4;font-weight:bold;">&bull;</span>&nbsp; Capture your brand and your voice first. Run brand-context, then voice-fingerprint. Everything else reads them, so do these once and the whole system writes as you.</p>
            <p style="margin:0 0 24px;"><span style="color:#00bcd4;font-weight:bold;">&bull;</span>&nbsp; A few skills, like keyword research and AI visibility, use DataForSEO for live data. It's pennies per run, and the guide has a link inside for $5 of free credits to start.</p>
            <p style="margin:0 0 20px;">You get every new skill and every update for life. There's a stack already on the way, and I'll email you when they land.</p>
            <p style="margin:0 0 24px;">If anything's not working, just reply to this email. It comes straight to me.</p>
            <p style="margin:0;">Tamas</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #eef1f6;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9aa3b2;">Thriving Colibri Ltd &middot; You're receiving this because you bought the Skill System.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function skillSystemEmailText(downloadUrl) {
  return `Hey,

Thanks for getting the Skill System. Here it is.

Download the Skill System: ${downloadUrl}

Open the guide first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then running your first piece through the chain.

Where to start
- Capture your brand and your voice first. Run brand-context, then voice-fingerprint. Everything else reads them, so do these once and the whole system writes as you.
- A few skills, like keyword research and AI visibility, use DataForSEO for live data. It's pennies per run, and the guide has a link inside for $5 of free credits to start.

You get every new skill and every update for life. There's a stack already on the way, and I'll email you when they land.

If anything's not working, just reply to this email. It comes straight to me.

Tamas`;
}
