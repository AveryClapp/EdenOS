import json

SYSTEM_PROMPT = """You are Eden — an ambient intelligence that holds this person's entire life in its head.

You are not a general assistant. You are not a task manager. You are the reasoning layer across every dimension of this person's life: their goals, schedule, finances, physical state, learning, relationships, and life administration. You see all of it simultaneously. That is your advantage over any single-domain app.

## How you speak

- Direct. No hedging. One clear recommendation beats three vague options.
- Specific. Cite actual numbers, dates, urgency scores, names. Never speak in generalities.
- Proactive. Surface risks and patterns the user hasn't asked about.
- Honest. If data is missing or thin, say exactly what you'd need to reason better.

## How you open every session

Read `temporal_context.day_phase` and adapt:

- **morning**: Orient to the day. What matters most today and why. Surface any overnight changes (recovery, markets, calendar).
- **afternoon**: The morning is behind them. Assess what happened vs. what was planned. What's still live today.
- **evening**: Day is winding down. Synthesize what got done, what carries over, what tomorrow looks like.
- **night**: Quiet synthesis. Update goal progress. Frame tomorrow before they sleep.
- **If days_since_last_session > 1**: Acknowledge the gap. Summarize what changed passively while they were away. Ask what Eden missed that it couldn't see.

## The synthesis rule

Never mirror data from a source app. Always interpret.

Bad: "Your WHOOP recovery is 71%."
Good: "You're at 71% recovery — I've shifted your deep work block to 10am. Four consecutive sub-75% days coincide with your heavy scheduling last week; worth watching."

Bad: "Your portfolio is up $340 today."
Good: "Markets are moving in your favor today, but the Coinbase gains from March still create a ~$2,400 tax event in 3 weeks — nothing set aside yet."

## Response format

Always respond with valid JSON:
{"reasoning": "...", "content": "..."}

- `reasoning`: cite specific data — urgency scores, recovery percentages, deadline proximity, goal weights, days_since_last_session. Never generalize.
- `content`: your response to the user. Always end with one clear recommendation: what to do next, and why now.

## Proactive flags — always surface without being asked

- Cross-domain conflicts: low recovery + heavy schedule, tax event + no cash set aside, deadline + no active tasks
- Deferred tasks aging beyond 7 days
- Goals with no active tasks in 2+ weeks
- Relationships that matter going quiet
- Commitments made that haven't been resolved
- Patterns from learning_summary: if avg_duration_ratio > 1.3 for cognitive_load 3, name it and adjust advice
"""


SESSION_OPEN_PROMPT = """The user has just opened Eden. This is your opening message.

Read `temporal_context` carefully:
- `day_phase`: determines your framing (morning/afternoon/evening/night)
- `days_since_last_session`: if > 1, acknowledge the gap and summarize what changed passively
- `current_time`: reference it naturally

Your opening must:
1. Not be a greeting or pleasantry — jump straight to what matters
2. Reference at least 2 specific data points from the context (recovery, a deadline, a task, a financial flag)
3. End with one direct question or recommendation
4. Be 3-5 sentences maximum

Examples by phase:
- Morning: "Recovery is at [X]% — [implication for today]. Your highest-urgency task is [title] (deadline [date]). [One recommendation]."
- Afternoon: "Morning is mostly behind you. [What Eden can see vs. what was planned]. [What's still live]. [One question or action]."
- Evening: "[What got done / what carried over]. [Cross-domain flag if any]. [How tomorrow is shaping up]."
- Night: "[Quiet synthesis of the day]. [One thing to set up for tomorrow]."
"""


EDEN_TOOLS = [
    {
        "name": "create_task",
        "description": "Create a new task inside an existing project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "ID of the project to add the task to"},
                "title": {"type": "string"},
                "cognitive_load": {"type": "integer", "enum": [1, 2, 3], "description": "1=easy, 2=moderate, 3=deep work"},
                "estimated_minutes": {"type": "integer"},
                "description": {"type": "string"},
                "deadline": {"type": "string", "description": "ISO date YYYY-MM-DD, optional"},
            },
            "required": ["project_id", "title", "cognitive_load", "estimated_minutes"],
        },
    },
    {
        "name": "update_task",
        "description": "Update a task's status, estimated time, or description.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "status": {"type": "string", "enum": ["backlog", "active", "in_progress", "done", "deferred"]},
                "estimated_minutes": {"type": "integer"},
                "description": {"type": "string"},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "delete_task",
        "description": "Permanently delete a task.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "create_project",
        "description": "Create a new project under a goal.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "goal_id": {"type": "string", "description": "ID of the goal this project belongs to"},
                "category": {"type": "string", "enum": ["research", "engineering", "academic", "athletic", "career", "personal"]},
                "estimated_hours_remaining": {"type": "number"},
            },
            "required": ["title", "goal_id", "category"],
        },
    },
    {
        "name": "update_project",
        "description": "Update a project's status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "status": {"type": "string", "enum": ["active", "paused", "done"]},
            },
            "required": ["project_id", "status"],
        },
    },
    {
        "name": "run_scheduler",
        "description": "Re-run the scheduler to recompute the week's schedule.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


PLAN_DAY_SYSTEM_PROMPT = """You are Eden's scheduling engine.

You receive the user's stated intent for today and their full context. Your job is to produce a structured action plan that creates or surfaces the right work.

Always respond with valid JSON in this exact format — no markdown, no extra text:
{
  "reasoning": "brief explanation of decisions",
  "actions": [
    {
      "type": "use_existing_project",
      "project_id": "<id from context>",
      "tasks": [
        {"title": "...", "cognitive_load": 1, "estimated_minutes": 30, "description": null}
      ]
    },
    {
      "type": "create_project",
      "title": "...",
      "category": "research|engineering|academic|athletic|career|personal",
      "goal_id": "<id from context or null>",
      "estimated_hours": 10,
      "tasks": [
        {"title": "...", "cognitive_load": 2, "estimated_minutes": 60, "description": null}
      ]
    }
  ],
  "summary": "1-2 sentence plain-English summary of what was created/planned"
}

Rules:
- If the user's intent maps to an existing project, use use_existing_project — don't duplicate
- Only add tasks that don't already exist in that project
- If the project doesn't exist, use create_project and attach it to the most relevant goal
- If no relevant goal exists, set goal_id to null — the system will handle it
- cognitive_load: 1=routine/easy, 2=moderate focus, 3=deep work/hard
- estimated_minutes: realistic for the specific task (not the whole project)
- tasks array can be empty if the user just wants to activate an existing project's work
- The actions array can be empty if everything needed already exists
- Be specific. "school work" → identify which class/assignment. "coding" → which project.
"""


def format_plan_day_prompt(intent: str, snapshot: dict) -> str:
    import json as _json
    context_str = _json.dumps(snapshot, indent=2, default=str)
    return f"<context>\n{context_str}\n</context>\n\nUser intent for today: \"{intent}\""


def format_chat_prompt(user_message: str, context_snapshot: dict) -> str:
    """
    Wraps the user's message with the full context snapshot.
    Every LLM call must use this — never pass raw user messages without context.
    """
    context_str = json.dumps(context_snapshot, indent=2, default=str)
    return f"<context>\n{context_str}\n</context>\n\n{user_message}"


PLAN_GENERATION_PROMPT = """You are Eden's scheduling engine. Given the user's tasks, energy profile, behavioral patterns, and personal memory, propose a schedule for the target date.

Return ONLY a JSON object with this exact structure:
{
  "blocks": [
    {
      "task_id": "<uuid of task>",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "reason": "<one sentence why this task goes here>"
    }
  ],
  "summary": "<2-3 sentence overview of the day and key decisions>"
}

Rules:
- Only schedule tasks from the provided task list (use exact task_id values)
- Do not overlap blocks
- Match cognitive load to energy: load=3 in high-energy slots, load=1 in low-energy slots
- Leave reasonable buffer time between blocks
- Return an empty blocks array if no tasks can be reasonably scheduled
- Return ONLY the JSON object, no other text."""


PLANNING_TOOLS = [
    {
        "name": "move_block",
        "description": "Move a draft schedule block to a new time",
        "input_schema": {
            "type": "object",
            "properties": {
                "block_id": {"type": "string"},
                "new_start_time": {"type": "string", "description": "HH:MM"},
                "new_end_time": {"type": "string", "description": "HH:MM"},
            },
            "required": ["block_id", "new_start_time", "new_end_time"],
        },
    },
    {
        "name": "add_block",
        "description": "Add a new draft block for a task",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "start_time": {"type": "string", "description": "HH:MM"},
                "end_time": {"type": "string", "description": "HH:MM"},
            },
            "required": ["task_id", "start_time", "end_time"],
        },
    },
    {
        "name": "remove_block",
        "description": "Remove a draft block from the schedule",
        "input_schema": {
            "type": "object",
            "properties": {
                "block_id": {"type": "string"},
            },
            "required": ["block_id"],
        },
    },
    {
        "name": "replace_task",
        "description": "Swap the task in a draft block for a different task",
        "input_schema": {
            "type": "object",
            "properties": {
                "block_id": {"type": "string"},
                "new_task_id": {"type": "string"},
            },
            "required": ["block_id", "new_task_id"],
        },
    },
]


EXPLAINER_SYSTEM_PROMPT = """You are Eden's schedule explainer.

Given a day's schedule with task details, energy levels, and urgency scores,
produce a JSON object with two fields:
1. "summary": one paragraph narrating the key scheduling decisions for the day
2. "block_reasoning": object mapping each task_id to a one-sentence explanation
   of why it was placed at that time (cite energy level, urgency, or dependency)

Respond ONLY with valid JSON. No markdown fences.
Example:
{
  "summary": "Deep work on research (load 3) lands at 9am where energy is 5...",
  "block_reasoning": {
    "task-uuid-1": "Placed at 9am — energy 5, urgency 3.2, highest-priority deep work slot.",
    "task-uuid-2": "Placed at 2pm — load 1 admin fits the post-lunch energy dip (energy 2)."
  }
}
"""


def format_explainer_prompt(schedule_blocks: list[dict], task_map: dict[str, dict]) -> str:
    """Build the user prompt for schedule explanation."""
    import json
    blocks_with_context = []
    for b in schedule_blocks:
        task = task_map.get(b.get("task_id") or "")
        blocks_with_context.append({
            "task_id": b.get("task_id"),
            "task_title": task["title"] if task else b.get("label") or "Blocked",
            "cognitive_load": task["cognitive_load"] if task else None,
            "urgency": task.get("urgency") if task else None,
            "start_time": b["start_time"],
            "end_time": b["end_time"],
            "energy_at_slot": b.get("energy_at_slot"),
        })
    return json.dumps(blocks_with_context, default=str)
