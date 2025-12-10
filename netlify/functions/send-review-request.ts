import type { Handler } from "@netlify/functions";
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const GOOGLE_REVIEW_LINK = "https://share.google/Xterp74G4U1dsYb98";
// Placeholder for now: 
// const GOOGLE_REVIEW_LINK = "https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { bookings } = JSON.parse(event.body || "{}");

    if (!bookings || !Array.isArray(bookings) || bookings.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No bookings provided" }),
      };
    }

    let sentCount = 0;
    const errors: string[] = [];

    // Allow user to pass a custom link if they want, otherwise use default
    // For now hardcoded or env var
    const reviewLink = process.env.GOOGLE_REVIEW_LINK || GOOGLE_REVIEW_LINK;

    for (const booking of bookings) {
      if (!booking.email) {
        errors.push(`Skipped ${booking.name}: No email`);
        continue;
      }

      const mailOptions = {
        from: `"Dubai Rent 7.0" <${process.env.GMAIL_USER}>`,
        to: booking.email,
        subject: "Come è stata la tua esperienza con DR7?",
        html: `
          <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #111; color: #fff; padding: 0;">
            <!-- Header -->
            <div style="background-color: #000; padding: 20px; text-align: center; border-bottom: 2px solid #D4AF37;">
              <h1 style="color: #D4AF37; margin: 0; font-size: 24px; letter-spacing: 2px;">DUBAI RENT 7.0</h1>
            </div>

            <!-- Content -->
            <div style="padding: 40px 20px; text-align: center;">
              
              <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                La tua esperienza con noi è importante.
              </p>

              <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                Se ti fa piacere, lascia una recensione a 5 stelle raccontando il tuo Servizio ricevuto, è il modo migliore per crescere insieme.
              </p>

              <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                In segno di gratitudine, inviandoci uno screenshot della recensione riceverai subito un buono sconto da 100€ sul tuo prossimo noleggio e uno da 10€ sul tuo prossimo lavaggio.
              </p>

              <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                Clicca qui per lasciarla!👇🏻
              </p>

              <!-- CTA Button -->
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #D4AF37; color: #000; padding: 15px 30px; text-decoration: none; font-weight: bold; border-radius: 5px; font-size: 16px; margin: 10px 0;">
                LASCIA UNA RECENSIONE
              </a>
              
              <p style="color: #888; font-size: 14px; margin-top: 30px;">
                DR7 S.p.A.<br>
                <a href="${reviewLink}" style="color: #D4AF37;">${reviewLink}</a>
              </p>

            </div>

            <!-- Footer -->
            <div style="background-color: #000; padding: 20px; text-align: center; border-top: 1px solid #333;">
              <p style="color: #666; font-size: 12px; margin: 0;">
                © ${new Date().getFullYear()} Dubai Rent 7.0 Empire. Tutti i diritti riservati.
              </p>
            </div>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        sentCount++;
      } catch (err: any) {
        console.error(`Error sending review email to ${booking.email}:`, err);
        errors.push(`${booking.name}: ${err.message}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sent: sentCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
    };
  } catch (error: any) {
    console.error("Handler error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
