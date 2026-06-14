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
      const prompt = `You are an AI evaluator. Judge if the AI response meets the expected behavior.

USER INPUT: ${userInput}
EXPECTED BEHAVIOR: ${expected}
AI RESPONSE: ${aiResponse}

Respond ONLY with valid JSON:
{"verdict": "pass" | "partial" | "fail", "feedback": "One clear sentence explaining why."}

- "pass": Response clearly meets the expected behavior
- "partial": Partially meets it but misses something important
- "fail": Does not meet the expected behavior`;

      const text = await groq(GROQ_API_KEY, model, [{ role: 'user', content: prompt }], 150, 0);
      return res.status(200).json(parseJSON(text, { verdict: 'partial', feedback: 'Could not parse judgment.' }));
    }

    // ── MODE: validate ─────────────────────────────────────────────
    // Check if a test case is clear, realistic, and measurable
    if (mode === 'validate') {
      const prompt = `You are a QA expert reviewing a test case for AI prompt evaluation.

INPUT/SCENARIO: "${userInput}"
EXPECTED BEHAVIOR: "${expected}"

Check:
1. Is the input realistic and clear?
2. Is the expected behavior specific and measurable? (not vague like "respond well")
3. Are there any contradictions or impossibilities?

Respond ONLY with valid JSON:
{"quality": "good" | "improve" | "invalid", "feedback": "One clear sentence explaining quality and what to fix if needed."}

- "good": Clear, realistic, measurable
- "improve": Somewhat clear but vague or needs more detail
- "invalid": Contradictory, impossible, or completely unmeasurable`;

      const text = await groq(GROQ_API_KEY, model, [{ role: 'user', content: prompt }], 150, 0);
      return res.status(200).json(parseJSON(text, { quality: 'improve', feedback: 'Could not validate this test case.' }));
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
