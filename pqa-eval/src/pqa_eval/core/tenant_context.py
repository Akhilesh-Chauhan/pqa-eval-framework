from __future__ import annotations

import contextvars
from concurrent.futures import Executor, Future

from pqa_eval.core.exceptions import CrossTenantViolation, NoTenantContextError

_active: contextvars.ContextVar["TenantContext | None"] = contextvars.ContextVar(
    "pqa_eval_active_tenant", default=None
)


class TenantContext:
    """Fail-closed tenant scope. Nothing tenant-bearing works outside one.

    Usage: `with TenantContext("commerce"): ...` — nesting is forbidden
    (one evaluation run = exactly one context; see spec section 6).
    """

    def __init__(self, tenant_id: str):
        if not tenant_id or not isinstance(tenant_id, str):
            raise ValueError("tenant_id must be a non-empty string")
        self.tenant_id = tenant_id
        self._token: contextvars.Token | None = None

    @classmethod
    def current(cls) -> "TenantContext":
        ctx = _active.get()
        if ctx is None:
            raise NoTenantContextError(
                "No active TenantContext. All dataset, metric, client and report "
                "operations must run inside `with TenantContext(tenant_id): ...`"
            )
        return ctx

    def assert_owns(self, obj_tenant_id: str, *, what: str) -> None:
        if obj_tenant_id != self.tenant_id:
            raise CrossTenantViolation(
                f"{what} belongs to tenant '{obj_tenant_id}' but the active "
                f"tenant is '{self.tenant_id}'. Refusing to proceed."
            )

    def __enter__(self) -> "TenantContext":
        if _active.get() is not None:
            raise CrossTenantViolation(
                f"TenantContext('{self.tenant_id}') opened while "
                f"'{_active.get().tenant_id}' is still active. One run, one tenant."
            )
        self._token = _active.set(self)
        return self

    def __exit__(self, *exc) -> None:
        _active.reset(self._token)
        self._token = None


def run_in_context(executor: Executor, fn, /, *args, **kwargs) -> Future:
    """Submit fn to executor with the caller's contextvars (incl. TenantContext).

    ThreadPoolExecutor does NOT propagate contextvars by itself; every
    parallel metric execution in the runner must go through this helper.
    """
    ctx = contextvars.copy_context()
    return executor.submit(ctx.run, fn, *args, **kwargs)
