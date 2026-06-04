import type { Handler } from "@netlify/functions";
import { Resend } from 'resend';
import { getGoogleReviewLink } from './utils/loadMarketing';

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

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "RESEND_API_KEY not configured" }),
      };
    }

    const resend = new Resend(apiKey);
    let sentCount = 0;
    const errors: string[] = [];

    // Letto da centralina_pro_config.config.marketing.google_review_link.
    const reviewLink = await getGoogleReviewLink();

    for (const booking of bookings) {
      if (!booking.email) {
        errors.push(`Skipped ${booking.name}: No email`);
        continue;
      }

      try {
        const { error } = await resend.emails.send({
          from: 'DR7 <info@dr7.app>',
          to: booking.email,
          subject: "Come è stata la tua esperienza con DR7?",
          html: `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #111; color: #fff; padding: 0;">
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

                <a href="${reviewLink}"
                   style="display: inline-block; background-color: #D4AF37; color: #000; padding: 15px 30px; text-decoration: none; font-weight: bold; border-radius: 5px; font-size: 16px; margin: 10px 0;">
                  LASCIA UNA RECENSIONE
                </a>

              </div>
            </div>
          `,
        });

        if (error) {
          console.error(`Error sending review email to ${booking.email}:`, error);
          errors.push(`${booking.name}: ${error.message}`);
        } else {
          sentCount++;
        }
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
