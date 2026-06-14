# PromptProof 🔬

**Test your AI prompts before your users find the failures.**

PromptProof lets you write a system prompt, define test cases with expected behaviors, and automatically evaluate how well your prompt performs — scored by an AI judge.

---

## Deploy to Vercel

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial PromptProof"
git remote add origin https://github.com/YOUR_USERNAME/promptproof.git
git push -u origin main
```

### Step 2: Deploy on Vercel
1. Go to vercel.com → New Project
2. Import your GitHub repo
3. Add Environment Variable:
   - Key: `GROQ_API_KEY`
   - Value: your Groq API key from console.groq.com
4. Click Deploy

### Step 3: Done!
Your app will be live at `promptproof.vercel.app` (or your custom domain).

---

## How It Works

1. **Enter your system prompt** — the instruction you give to your AI
2. **Add test cases** — define input scenarios and expected behaviors
3. **Run PromptProof** — the app tests each scenario and uses AI-as-judge to score responses
4. **See results** — pass/fail/partial scores with explanations

---

## Stack
- Frontend: Vanilla HTML/CSS/JS
- Backend: Vercel Serverless Functions
- AI: Groq API (llama-3.3-70b-versatile)
- Evaluation: AI-as-judge pattern

Built by Srinivas Malempati | srinivas-malempati.github.io
