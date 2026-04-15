import logging

try:
    import anthropic
except ImportError:
    anthropic = None

from app.errors import PipelineError

logger = logging.getLogger(__name__)

MODEL_NAME = "claude-sonnet-4-6"
client = anthropic.Anthropic(timeout=30.0) if anthropic is not None else None


def call_model(system: str, user: str) -> str:
    if client is None:
        error = ImportError("anthropic package is not installed")
        logger.error("anthropic SDK unavailable: %s", error, exc_info=True)
        raise PipelineError(stage="call_model", raw_response="", cause=error) from error

    if anthropic is None:
        error = RuntimeError("anthropic SDK import unexpectedly unavailable")
        logger.error("anthropic SDK unavailable after client init: %s", error, exc_info=True)
        raise PipelineError(stage="call_model", raw_response="", cause=error) from error

    try:
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
