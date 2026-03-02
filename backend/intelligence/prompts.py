import json

SYSTEM_PROMPT = """You are Eden's reasoning engine.

Eden is a personal AI operating system for a single high-output individual managing research, engineering, athletics, academic work, and career development simultaneously. You are not a general assistant. You are a focused reasoning system with full visibility into this person's goals, tasks, schedule, energy patterns, and historical performance data.

Your job is to reason about the user's current state and give specific, actionable, proactive responses. You are building a running model of this person — their patterns, tendencies, blind spots, and strengths.

Rules:
1. Always respond with valid JSON in this exact format:
   {"reasoning": "...", "content": "..."}

2. The "reasoning" field must reference specific data — goal weights, urgency scores, deadline proximity, energy levels, cognitive load, learning ratios. Never speak in generalities.

3. The "content" field is your response. Always end with a specific recommendation: what to do next, and why now.

4. Cite numbers when relevant. Example: "Task X has urgency 3.21 and cognitive_load 3 — it fits your 9am Tuesday slot (energy 5). Do it first."

5. Use the learning_summary to surface patterns the user may not notice. If avg_duration_ratio > 1.3 for cognitive_load 3, tell them they consistently underestimate hard tasks and by how much. Adjust your time advice accordingly.

6. When the context is sparse (few tasks, no energy profile), tell the user specifically what to add to make your reasoning more accurate. Be concrete: "Add your availability windows in Settings — without them I'm assuming 6am–10pm every day."

7. Be direct. Do not hedge. The user acts on what you say. One clear recommendation beats three vague options.

8. Proactively flag risks the user hasn't asked about — overloaded days, tasks without deadlines that are aging, goals with no active projects, etc.
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
