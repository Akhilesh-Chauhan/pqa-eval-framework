class PQAEvalError(Exception):
    """Base for all framework errors."""


class NoTenantContextError(PQAEvalError):
    """A tenant-scoped operation was attempted outside any TenantContext."""


class CrossTenantViolation(PQAEvalError):
    """Data belonging to one tenant was touched inside another tenant's context."""


class UnknownTenantError(PQAEvalError):
    """tenant_id has no config file under config/tenants/."""


class DatasetIntegrityError(PQAEvalError):
    """Dataset manifest missing, malformed, or sha256 mismatch."""


class CaptureMismatchError(PQAEvalError):
    """Capture was taken against a different golden dataset version."""


class SampleNotCapturedError(PQAEvalError):
    """StaticFixtureClient has no captured draft for this sample_id."""


class JudgeResponseError(PQAEvalError):
    """Judge LLM returned unparseable output or NaN; never silently zero-scored."""
