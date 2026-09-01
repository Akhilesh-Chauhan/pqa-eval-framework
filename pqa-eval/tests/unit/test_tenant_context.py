from concurrent.futures import ThreadPoolExecutor

import pytest

from pqa_eval.core.exceptions import CrossTenantViolation, NoTenantContextError
from pqa_eval.core.tenant_context import TenantContext, run_in_context


def test_current_raises_outside_context():
    with pytest.raises(NoTenantContextError):
        TenantContext.current()


def test_current_inside_context():
    with TenantContext("commerce") as ctx:
        assert TenantContext.current() is ctx
        assert ctx.tenant_id == "commerce"
    with pytest.raises(NoTenantContextError):
        TenantContext.current()


def test_assert_owns_pass_and_fail():
    with TenantContext("commerce") as ctx:
        ctx.assert_owns("commerce", what="golden g1")  # no raise
        with pytest.raises(CrossTenantViolation) as e:
            ctx.assert_owns("defence", what="golden g2")
        assert "defence" in str(e.value) and "commerce" in str(e.value)


def test_nesting_is_forbidden():
    with TenantContext("commerce"):
        with pytest.raises(CrossTenantViolation):
            with TenantContext("defence"):
                pass
        # same-tenant nesting is equally forbidden: one run = one context
        with pytest.raises(CrossTenantViolation):
            with TenantContext("commerce"):
                pass


def test_context_propagates_to_thread_pool_via_helper():
    def worker() -> str:
        return TenantContext.current().tenant_id

    with TenantContext("commerce"):
        with ThreadPoolExecutor(max_workers=2) as ex:
            # plain submit does NOT propagate contextvars -> must raise
            with pytest.raises(NoTenantContextError):
                ex.submit(worker).result()
            # the helper does
            assert run_in_context(ex, worker).result() == "commerce"


# --- Isolation guarantees beyond the plan's cases -------------------------
# This module is the choke point for the product's tenant-isolation
# invariant, so the ways it could silently fail are pinned down here.


def test_exception_inside_block_does_not_leak_context():
    with pytest.raises(RuntimeError):
        with TenantContext("commerce"):
            raise RuntimeError("boom")
    with pytest.raises(NoTenantContextError):
        TenantContext.current()


def test_rejected_nesting_leaves_outer_context_intact():
    with TenantContext("commerce"):
        with pytest.raises(CrossTenantViolation):
            with TenantContext("defence"):
                pass
        assert TenantContext.current().tenant_id == "commerce"


def test_concurrent_threads_see_only_their_own_tenant():
    """Two tenants evaluated at genuinely overlapping times must not observe
    each other. The barrier forces real overlap rather than accidental
    serialisation."""
    import threading

    seen: dict[str, str] = {}
    barrier = threading.Barrier(2)

    def work(tenant: str) -> None:
        with TenantContext(tenant):
            barrier.wait(timeout=5)
            seen[tenant] = TenantContext.current().tenant_id

    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(work, ["commerce", "defence"]))

    assert seen == {"commerce": "commerce", "defence": "defence"}


def test_worker_cannot_switch_tenant_inside_propagated_context():
    """Defence in depth: a worker that inherited a context must not be able to
    open a different tenant's context inside it."""
    def rogue() -> str:
        with TenantContext("defence"):
            return "entered"

    with TenantContext("commerce"):
        with ThreadPoolExecutor(max_workers=1) as ex:
            with pytest.raises(CrossTenantViolation):
                run_in_context(ex, rogue).result()
        assert TenantContext.current().tenant_id == "commerce"


@pytest.mark.parametrize("bad", ["", None, 123])
def test_invalid_tenant_ids_rejected(bad):
    with pytest.raises(ValueError):
        TenantContext(bad)
