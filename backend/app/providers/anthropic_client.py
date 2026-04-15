import logging
import os

try:
    import anthropic
except ImportError:
    anthropic = None

from app.errors import PipelineError

logger = logging.getLogger(__name__)

MODEL_NAME = "claude-sonnet-4-6"


def _build_client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    return anthropic.Anthropic(api_key=api_key, timeout=30.0)


def call_model(system: str, user: str) -> str:
    if anthropic is None:
        error = ImportError("anthropic package is not installed")
        logger.error("anthropic SDK unavailable: %s", error, exc_info=True)
        raise PipelineError(stage="call_model", raw_response="", cause=error) from error

    try:
        client = _build_client()
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except (
        anthropic.APITimeoutError,
        anthropic.APIConnectionError,
        anthropic.RateLimitError,
        anthropic.APIError,
    ) as error:
        logger.error("anthropic model call failed: %s", error, exc_info=True)
        raise PipelineError(stage="call_model", raw_response="", cause=error) from error
    except Exception as error:
        logger.error("anthropic model call failed unexpectedly: %s", error, exc_info=True)
        raise PipelineError(stage="call_model", raw_response="", cause=error) from error

    if not response.content or response.content[0].type != "text":
        logger.error("unexpected anthropic response shape")
        raise PipelineError(
            stage="call_model",
            raw_response=str(response.content),
            cause=ValueError("unexpected response shape from API"),
        )

    logger.info("anthropic model call complete")
    return response.content[0].text
