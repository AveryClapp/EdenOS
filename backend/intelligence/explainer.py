import json
import anthropic

from backend.config import settings
from backend.intelligence.prompts import EXPLAINER_SYSTEM_PROMPT, format_explainer_prompt


def generate_schedule_explanation(
    schedule_blocks: list[dict],
    task_map: dict[str, dict],
) -> dict:
    """
    Call Claude to explain today's scheduling decisions.
    Returns {"summary": str, "block_reasoning": {task_id: str}}.
    Falls back to empty result on any error.
    """
    if not schedule_blocks:
        return {"summary": "", "block_reasoning": {}}

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    prompt = format_explainer_prompt(schedule_blocks, task_map)

    try:
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=1024,
            system=EXPLAINER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        parsed = json.loads(raw)
        return {
            "summary": parsed.get("summary", ""),
            "block_reasoning": parsed.get("block_reasoning", {}),
        }
    except Exception:
        return {"summary": "", "block_reasoning": {}}
