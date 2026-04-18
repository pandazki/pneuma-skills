---
name: critique
description: "Evaluate design from a UX perspective, assessing visual hierarchy, information architecture, emotional resonance, cognitive load, and overall quality with quantitative scoring, persona-based testing, automated anti-pattern detection, and actionable feedback. Use when the user asks to review, critique, evaluate, or give feedback on a design or component."
argument-hint: "[area (feature, page, component...)]"
user-invocable: true
---

## STEPS

### Step 1: Preparation

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it contains the design principles, anti-patterns, and Context Gathering Protocol. If no design context exists yet, you MUST run the `teach` command first (see [cmd-teach](cmd-teach.md)). Additionally gather: what the interface is trying to accomplish.

### Step 2: Gather Assessments

Launch two independent assessments. **Neither must see the other's output** to avoid bias.

You SHOULD delegate each assessment to a separate sub-agent for independence. Use your environment's agent spawning mechanism (e.g., Claude Code's `Agent` tool, or Codex's subagent spawning). Sub-agents should return their findings as structured text. Do NOT output findings to the user yet.

If sub-agents are not available in the current environment, complete each assessment sequentially, writing findings to internal notes before proceeding.

**Tab isolation**: When browser automation is available, each assessment MUST create its own new tab. Never reuse an existing tab, even if one is already open at the correct URL. This prevents the two assessments from interfering with each other's page state.

#### Assessment A: LLM Design Review

Read the relevant source files (HTML, CSS, JS/TS) and, if browser automation is available, visually inspect the live page. **Create a new tab** for this; do not reuse existing tabs. After navigation, label the tab by setting the document title:
```javascript
document.title = '[LLM] ' + document.title;
```
Think like a design director. Evaluate:

**AI Slop Detection (CRITICAL)**: Does this look like every other AI-generated interface? Review against ALL **DON'T** guidelines in the impeccable skill. Check for AI color palette, gradient text, dark glows, glassmorphism, hero metric layouts, identical card grids, generic fonts, and all other tells. **The test**: If someone said "AI made this," would you believe them immediately?

**Holistic Design Review**: visual hierarchy (eye flow, primary action clarity), information architecture (structure, grouping, cognitive load), emotional resonance (does it match brand and audience?), discoverability (are interactive elements obvious?), composition (balance, whitespace, rhythm), typography (hierarchy, readability, font choices), color (purposeful use, cohesion, accessibility), states & edge cases (empty, loading, error, success), microcopy (clarity, tone, helpfulness).

**Cognitive Load** (consult [cognitive-load](cognitive-load.md)):
- Run the 8-item cognitive load checklist. Report failure count: 0-1 = low (good), 2-3 = moderate, 4+ = critical.
- Count visible options at each decision point. If >4, flag it.
- Check for progressive disclosure: is complexity revealed only when needed?

**Emotional Journey**:
- What emotion does this interface evoke? Is that intentional?
- **Peak-end rule**: Is the most intense moment positive? Does the experience end well?
- **Emotional valleys**: Check for anxiety spikes at high-stakes moments (payment, delete, commit). Are there design interventions (progress indicators, reassurance copy, undo options)?

**Nielsen's Heuristics** (consult [heuristics-scoring](heuristics-scoring.md)):
Score each of the 10 heuristics 0-4. This scoring will be presented in the report.

Return structured findings covering: AI slop verdict, heuristic scores, cognitive load assessment, what's working (2-3 items), priority issues (3-5 with what/why/fix), minor observations, and provocative questions.

#### Assessment B: Automated Detection

Review the source files for the 25 specific patterns (AI slop tells + general design quality) documented in the impeccable skill. Catalog each finding with file location and specific evidence.

For large targets (many files), prioritize: components referenced on primary user flows, shared/reusable components, and any file flagged by Assessment A's visual review.

Return: file-based findings catalog, and any ambiguous cases flagged for reconciliation with Assessment A.

### Step 3: Generate Combined Critique Report

Synthesize both assessments into a single report. Do NOT simply concatenate. Weave the findings together, noting where the LLM review and the pattern catalog agree, where the catalog caught issues the LLM missed, and where pattern matches are false positives.

Structure your feedback as a design director would:

#### Design Health Score
> *Consult [heuristics-scoring](heuristics-scoring.md)*

Present the Nielsen's 10 heuristics scores as a table:

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | ? | [specific finding or "n/a" if solid] |
| 2 | Match System / Real World | ? | |
| 3 | User Control and Freedom | ? | |
| 4 | Consistency and Standards | ? | |
| 5 | Error Prevention | ? | |
| 6 | Recognition Rather Than Recall | ? | |
| 7 | Flexibility and Efficiency | ? | |
| 8 | Aesthetic and Minimalist Design | ? | |
| 9 | Error Recovery | ? | |
| 10 | Help and Documentation | ? | |
| **Total** | | **??/40** | **[Rating band]** |

Be honest with scores. A 4 means genuinely excellent. Most real interfaces score 20-32.

#### Anti-Patterns Verdict

**Start here.** Does this look AI-generated?

**LLM assessment**: Your own evaluation of AI slop tells. Cover overall aesthetic feel, layout sameness, generic composition, missed opportunities for personality.

**Pattern catalog scan**: Summarize what the pattern-based review found, with counts and file locations. Note any additional issues the catalog caught that you missed, and flag any false positives.

#### Overall Impression
A brief gut reaction: what works, what doesn't, and the single biggest opportunity.

#### What's Working
Highlight 2-3 things done well. Be specific about why they work.

#### Priority Issues
The 3-5 most impactful design problems, ordered by importance.

For each issue, tag with **P0-P3 severity** (consult [heuristics-scoring](heuristics-scoring.md) for severity definitions):
- **[P?] What**: Name the problem clearly
- **Why it matters**: How this hurts users or undermines goals
- **Fix**: What to do about it (be concrete)
- **Suggested command**: Which command could address this (from: {{available_commands}})

#### Persona Red Flags
> *Consult [personas](personas.md)*

Auto-select 2-3 personas most relevant to this interface type (use the selection table in the reference). If `{{config_file}}` contains a `## Design Context` section from a prior `teach` run, also generate 1-2 project-specific personas from the audience/brand info.

For each selected persona, walk through the primary user action and list specific red flags found:

**Alex (Power User)**: No keyboard shortcuts detected. Form requires 8 clicks for primary action. Forced modal onboarding. High abandonment risk.

**Jordan (First-Timer)**: Icon-only nav in sidebar. Technical jargon in error messages ("404 Not Found"). No visible help. Will abandon at step 2.

Be specific. Name the exact elements and interactions that fail each persona. Don't write generic persona descriptions; write what broke for them.

#### Minor Observations
Quick notes on smaller issues worth addressing.

#### Questions to Consider
Provocative questions that might unlock better solutions:
- "What if the primary action were more prominent?"
- "Does this need to feel this complex?"
- "What would a confident version of this look like?"

**Remember**:
- Be direct. Vague feedback wastes everyone's time.
- Be specific. "The submit button," not "some elements."
- Say what's wrong AND why it matters to users.
- Give concrete suggestions, not just "consider exploring..."
- Prioritize ruthlessly. If everything is important, nothing is.
- Don't soften criticism. Developers need honest feedback to ship great design.

### Step 4: Ask the User

**After presenting findings**, use targeted questions based on what was actually found. {{ask_instruction}} These answers will shape the action plan.

Ask questions along these lines (adapt to the specific findings; do NOT ask generic questions):

1. **Priority direction**: Based on the issues found, ask which category matters most to the user right now. For example: "I found problems with visual hierarchy, color usage, and information overload. Which area should we tackle first?" Offer the top 2-3 issue categories as options.

2. **Design intent**: If the critique found a tonal mismatch, ask whether it was intentional. For example: "The interface feels clinical and corporate. Is that the intended tone, or should it feel warmer/bolder/more playful?" Offer 2-3 tonal directions as options based on what would fix the issues found.

3. **Scope**: Ask how much the user wants to take on. For example: "I found N issues. Want to address everything, or focus on the top 3?" Offer scope options like "Top 3 only", "All issues", "Critical issues only".

4. **Constraints** (optional; only ask if relevant): If the findings touch many areas, ask if anything is off-limits. For example: "Should any sections stay as-is?" This prevents the plan from touching things the user considers done.

**Rules for questions**:
- Every question must reference specific findings from the report. Never ask generic "who is your audience?" questions.
- Keep it to 2-4 questions maximum. Respect the user's time.
- Offer concrete options, not open-ended prompts.
- If findings are straightforward (e.g., only 1-2 clear issues), skip questions and go directly to Step 5.

### Step 5: Recommended Actions

**After receiving the user's answers**, present a prioritized action summary reflecting the user's priorities and scope from Step 4.

#### Action Summary

List recommended commands in priority order, based on the user's answers:

1. **`command-name`**: Brief description of what to fix (specific context from critique findings)
2. **`command-name`**: Brief description (specific context)
...

**Rules for recommendations**:
- Only recommend commands from: {{available_commands}}
- Order by the user's stated priorities first, then by impact
- Each item's description should carry enough context that the command knows what to focus on
- Map each Priority Issue to the appropriate command
- Skip commands that would address zero issues
- If the user chose a limited scope, only include items within that scope
- If the user marked areas as off-limits, exclude commands that would touch those areas
- End with the `polish` command as the final step if any fixes were recommended

After presenting the summary, tell the user:

> You can ask me to run these one at a time, all at once, or in any order you prefer.
>
> Re-run the `critique` command after fixes to see your score improve.
