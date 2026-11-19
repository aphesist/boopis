"""``hypotaxis.governance``: governed mode, contraprova's escalation cascade run by the plugin (ARCHITECTURE 6).

The orchestrator (the session's model) never picks a model. It writes a brief and calls ``dispatch``. The plugin
creates the contraprova task, picks the tier from the ladder, and launches a worker through Hermes's ``delegate_task``,
routed to that tier by the plugin's own delegation provider. The worker's ``ship`` ends at the project's gate, and
the gate's verdict, not the worker's report, decides what happens next: a pass ends the task, a block makes the plugin
launch the next tier itself (``lifecycle``), with the brief, the failing output and the rejected diff.

Modules, from the pure to the Hermes-facing:

- ``ladder``, ``brief``, ``state``, ``handover``: pure. The ladder as data, the brief's rules, the state machine over
  ledger events, and the text a worker reads. No I/O.
- ``links``, ``runs``: what a process knows (which child is which attempt, the live tasks).
- ``host``: the few reads of Hermes's configuration the cascade needs.
- ``engine``: ``dispatch`` and the launch of one attempt. ``lifecycle``: ``subagent_start``/``subagent_stop``, the end
  of a task and what the orchestrator is told. ``delegation``: the provider that turns a launch into a model.

This ``__init__`` imports nothing: the plugin's import budget is 150 ms and every module here loads on first use.
"""
