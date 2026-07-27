"""Centralized logging configuration.

Uses Python's standard logging module (no new dependency) so behavior,
timings, and failures are visible in server logs instead of silently
swallowed or printed ad-hoc - important once this runs anywhere beyond a
local dev laptop (containers, hosted platforms, etc. all capture stdout
logging naturally).
"""
import logging
import sys


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        return  # already configured (e.g. reloader re-import)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
