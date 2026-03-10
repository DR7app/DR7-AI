import type { Handler } from "@netlify/functions";

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Business context for Claude
const SYSTEM_PROMPT = `Sei l'assistente virtuale di DR7 Empire, un'azienda di noleggio auto di lusso, supercar, e servizi premium a Dubai e in Italia.

SERVIZI OFFERTI:
- Noleggio auto di lusso e supercar (Ferrari, Lamborghini, Porsche, etc.)
- Noleggio auto urbane
- Flotta aziendale
- Jet privati ed elicotteri (su richiesta preventivo)
- Yachts (in sviluppo)

INFORMAZIONI UTILI:
- Sede: Dubai e Italia
- Contatto diretto: +39 345 790 5205
- Sito web: dr7empire.com
- Orari: disponibili 24/7 per emergenze

ISTRUZIONI:
1. Rispondi sempre in modo professionale e cordiale
2. Se il cliente chiede prezzi specifici, digli che i prezzi variano in base al periodo e alla disponibilità, e invitalo a visitare il sito o a contattare direttamente per un preventivo personalizzato
3. Se il cliente vuole prenotare, chiedi: tipo di veicolo, date desiderate, e luogo di ritiro
4. Per richieste complesse (jet, elicotteri, eventi speciali), informa che un consulente li contatterà presto
5. Rispondi nella stessa lingua del cliente (italiano o inglese)
6. Mantieni le risposte concise ma utili (max 3-4 frasi quando possibile)
7. Se non sai qualcosa, suggerisci di contattare direttamente il team

Non inventare prezzi o disponibilità specifiche. Sii sempre onesto e professionale.`;

// Store conversation history (in production, use a database)
const conversationHistory: Map<string, Array<{role: string, content: string}>> = new Map();

const handler: Handler = async (event) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle GET request (Green API webhook verification)
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "Webhook is active" }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Check configuration
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error("Green API not configured");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Green API not configured" }) };
  }

  if (!ANTHROPIC_API_KEY) {
    console.error("Anthropic API key not configured");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Anthropic API not configured" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    console.log("[WhatsApp AI] Received webhook:", JSON.stringify(payload, null, 2));

    // Green API webhook format
    const { typeWebhook, instanceData, messageData, senderData } = payload;

    // Only process incoming messages
    if (typeWebhook !== "incomingMessageReceived") {
      console.log("[WhatsApp AI] Ignoring webhook type:", typeWebhook);
      return { statusCode: 200, headers, body: JSON.stringify({ status: "ignored" }) };
    }

    // Extract message details
    const chatId = senderData?.chatId;
    const senderName = senderData?.senderName || "Cliente";
    const messageType = messageData?.typeMessage;

    // Only handle text messages
    if (messageType !== "textMessage" && messageType !== "extendedTextMessage") {
      console.log("[WhatsApp AI] Ignoring non-text message:", messageType);

      // Send a polite response for non-text messages
      await sendWhatsAppMessage(chatId, "Ciao! Al momento posso rispondere solo a messaggi di testo. Come posso aiutarti?");
      return { statusCode: 200, headers, body: JSON.stringify({ status: "non-text ignored" }) };
    }

    const userMessage = messageData?.textMessageData?.textMessage ||
                        messageData?.extendedTextMessageData?.text || "";

    if (!userMessage || !chatId) {
      console.log("[WhatsApp AI] Missing message or chatId");
      return { statusCode: 200, headers, body: JSON.stringify({ status: "missing data" }) };
    }

    console.log(`[WhatsApp AI] Message from ${senderName} (${chatId}): ${userMessage}`);

    // Get or create conversation history for this chat
    if (!conversationHistory.has(chatId)) {
      conversationHistory.set(chatId, []);
    }
    const history = conversationHistory.get(chatId)!;

    // Add user message to history
    history.push({ role: "user", content: userMessage });

    // Keep only last 10 messages to avoid token limits
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Call Claude API
    const aiResponse = await callClaudeAPI(history, senderName);

    if (aiResponse) {
      // Add assistant response to history
      history.push({ role: "assistant", content: aiResponse });

      // Send response via Green API
      await sendWhatsAppMessage(chatId, aiResponse);

      console.log(`[WhatsApp AI] Sent response to ${chatId}: ${aiResponse.substring(0, 100)}...`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "processed", response: aiResponse?.substring(0, 100) }),
    };

  } catch (error: any) {
    console.error("[WhatsApp AI] Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

async function callClaudeAPI(messages: Array<{role: string, content: string}>, senderName: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307", // Fast and cost-effective for chat
        max_tokens: 500,
        system: SYSTEM_PROMPT + `\n\nIl cliente si chiama: ${senderName}`,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[WhatsApp AI] Claude API error:", response.status, errorText);
      return "Mi scuso, ho avuto un problema tecnico. Per favore riprova tra poco o contatta direttamente il nostro team al +39 345 790 5205.";
    }

    const data = await response.json();
    return data.content?.[0]?.text || null;

  } catch (error: any) {
    console.error("[WhatsApp AI] Claude API call failed:", error);
    return "Mi scuso, non sono riuscito a elaborare la tua richiesta. Contatta il nostro team al +39 345 790 5205.";
  }
}

async function sendWhatsAppMessage(chatId: string, message: string): Promise<boolean> {
  try {
    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    const response = await fetch(greenApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: chatId,
        message: `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\nQuesto messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora.\n\n${message}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`,
      }),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error("[WhatsApp AI] Green API send error:", result);
      return false;
    }

    console.log("[WhatsApp AI] Message sent successfully:", result.idMessage);
    return true;

  } catch (error: any) {
    console.error("[WhatsApp AI] Failed to send WhatsApp message:", error);
    return false;
  }
}

export { handler };
