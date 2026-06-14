export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, systemPrompt, userInput, expected, aiResponse, mode } = req.body;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  try {

    // ── MODE: respond ──────────────────────────────────────────────
    // Run user input through the system prompt and get AI response
    if (mode === 'respond') {
      const response = await groq(GROQ_API_KEY, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userInput }
      ], 500, 0.3);
      return res.status(200).json({ aiResponse: response });
    }

    // ── MODE: judge ────────────────────────────────────────────────
    // AI-as-judge: did the response meet expected behavior?
    if (mode === 'judge') {
      const systemMsg = 'You are a fair AI evaluator. You MUST respond with valid JSON only. No markdown, no explanation, just JSON.';
      const userMsg = `Judge if this AI response meets the expected behavior.

USER INPUT: ${userInput}
EXPECTED BEHAVIOR: ${expected}
AI RESPONSE: ${aiResponse}

Return ONLY this JSON with no other text:
{"verdict":"pass","feedback":"reason here"}

Use verdict "pass" if the response addresses the main expected behavior even if wording differs.
Use verdict "partial" if the response addresses some but clearly misses one major point.
Use verdict "fail" if the response completely ignores or contradicts the expected behavior.
Be generous — judge on substance not style.`;

      const text = await groq(GROQ_API_KEY, 'llama-3.1-8b-instant', [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ], 200, 0);
      const parsed = parseJSON(text, null);
      if (parsed && parsed.verdict) {
        return res.status(200).json(parsed);
      }
      // Try to extract verdict manually if JSON fails
      const v = text.includes('"pass"') ? 'pass' : text.includes('"fail"') ? 'fail' : 'partial';
      const f = text.replace(/[{}"]/g,'').replace(/verdict:|feedback:/g,'').trim().substring(0, 120);
      return res.status(200).json({ verdict: v, feedback: f || 'Evaluated successfully.' });
    }

    // ── MODE: validate ─────────────────────────────────────────────
    // Check if a test case is clear, realistic, and measurable
    if (mode === 'validate') {
      const systemMsg = 'You are a QA expert. You MUST respond with valid JSON only. No markdown, no extra text.';
      const userMsg = `Review this test case quality.

INPUT: "${userInput}"
EXPECTED: "${expected}"

Return ONLY this JSON:
{"quality":"good","feedback":"reason here"}

Use "good" if input is realistic and expected behavior is specific and measurable.
Use "improve" if somewhat clear but expected behavior is vague or input needs more detail.
Use "invalid" if contradictory or impossible to measure.
Be generous — most realistic test cases should be "good".`;

      const text = await groq(GROQ_API_KEY, 'llama-3.1-8b-instant', [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ], 150, 0);
      const parsed = parseJSON(text, null);
      if (parsed && parsed.quality) {
        return res.status(200).json(parsed);
      }
      const q = text.includes('"good"') ? 'good' : text.includes('"invalid"') ? 'invalid' : 'improve';
      return res.status(200).json({ quality: q, feedback: 'Test case evaluated.' });
    }

    // ── MODE: suggest ──────────────────────────────────────────────
    // Rewrite the prompt based on failed test cases
    if (mode === 'suggest') {
      const { failedCases } = req.body;
      const failureSummary = failedCases.map((r, i) =>
        `Case ${i + 1}:\n  Input: "${r.input}"\n  Expected: "${r.expected}"\n  Feedback: "${r.feedback}"`
      ).join('\n\n');

      const prompt = `You are an expert prompt engineer. A system prompt failed more than 50% of its test cases.

ORIGINAL SYSTEM PROMPT:
${systemPrompt}

FAILED TEST CASES:
${failureSummary}

Rewrite the system prompt to fix these failures while keeping the original intent.
Rules:
- Keep the same purpose and tone
- Add specific instructions to handle the failed scenarios
- Be explicit about edge cases
- Do NOT add unnecessary complexity
- Return ONLY the improved prompt text, no explanation or preamble`;

      const improved = await groq(GROQ_API_KEY, model, [
        { role: 'system', content: 'You are an expert prompt engineer. Return only the improved prompt text.' },
        { role: 'user',   content: prompt }
      ], 800, 0.4);

      return res.status(200).json({ aiResponse: improved });
    }

    return res.status(400).json({ error: 'Invalid mode. Use: respond | judge | validate | suggest' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ────────────────────────────────────────────────────────
async function groq(apiKey, model, messages, maxTokens = 500, temperature = 0.3) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function parseJSON(text, fallback) {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return fallback;
  }
}
