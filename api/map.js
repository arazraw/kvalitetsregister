// Vercel serverless function. Reads OPENROUTER_API_KEY from Vercel's own
// environment-variable store (Project Settings -> Environment Variables) —
// the key never reaches the browser and never passes through this repo.
//
// Uses OpenRouter's Decisions API (POST /api/alpha/decisions), which is built
// for exactly this: each register field becomes a "choice" question over its
// allowed values, and Jev returns a calibrated confidence (0-1) per answer —
// no free-text parsing needed.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "typesafe/jev-1.13";

  if (!apiKey) {
    res.status(400).json({ error: "OPENROUTER_API_KEY saknas i miljövariablerna på Vercel." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { journalText = "", fields = [] } = body || {};

  if (!fields.length) {
    res.status(200).json({ results: {} });
    return;
  }

  const questions = {};
  for (const f of fields) {
    const opts = Array.isArray(f.options) && f.options.length ? f.options : ["Ja", "Nej", "Okänt"];
    questions[f.key] = {
      type: "choice",
      instructions: `${f.label}. Bedöm utifrån journalanteckningarna och bilddiagnostiken nedan.`,
      criteria: Object.fromEntries(opts.map(o => [o, o]))
    };
  }

  try {
    const upstream = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vercel.com",
        "X-Title": "Kvalitetsregister"
      },
      body: JSON.stringify({
        model,
        state: journalText,
        questions
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(502).json({ error: `OpenRouter-fel ${upstream.status}: ${JSON.stringify(data).slice(0, 500)}` });
      return;
    }

    const results = {};
    for (const f of fields) {
      const answer = data.answers ? data.answers[f.key] : null;
      if (answer && answer.type === "choice" && typeof answer.choice === "string") {
        results[f.key] = {
          value: answer.choice,
          confidence: Math.round((Number(answer.confidence) || 0) * 100),
          probabilities: answer.probabilities || null
        };
      } else {
        results[f.key] = { value: "Okänt", confidence: 0, probabilities: null };
      }
    }

    res.status(200).json({ results });
  } catch (err) {
    res.status(502).json({ error: `Kunde inte nå OpenRouter: ${err.message}` });
  }
};
