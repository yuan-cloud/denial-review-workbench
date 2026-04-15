class PipelineError(Exception):
    def __init__(self, stage: str, raw_response: str, cause: Exception):
        self.stage = stage
        self.raw_response = raw_response
        self.cause = cause
        super().__init__(f"Pipeline failed at {stage}: {cause}")
