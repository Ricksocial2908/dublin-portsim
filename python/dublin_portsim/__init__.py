"""Dublin PortSim: berth planning for Dublin Port (CC BY-SA 4.0).

Adapted from FineEnvs/PortSimEnv. The interactive episode runs in the
static web app; this package loads the same tasks and can check or grade
a plan with the dock-v1 reward formula.
"""

from importlib.resources import files
import json

__version__ = "0.1.0"


def load_tasks():
    path = files("dublin_portsim") / "tasks" / "tasks.json"
    return json.loads(path.read_text())


def load_task(task_id: str):
    for t in load_tasks():
        if t["task_id"] == task_id:
            return t
    raise KeyError(task_id)
