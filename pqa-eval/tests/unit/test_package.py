import pqa_eval


def test_package_importable_with_version():
    assert pqa_eval.__version__ == "0.1.0"
