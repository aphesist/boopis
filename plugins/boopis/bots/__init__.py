"""Teammates (docs/ARCHITECTURE.md section 10a): Hermes profiles, plus what only boopis knows about them.

A teammate **is** a Hermes profile (ADR-0006). Hermes owns everything about it: the folder, ``SOUL.md``, memory,
skills, the model, the schedule. The UI reaches those through Hermes's own gateway methods (``profiles.*``,
``cron.manage``). This package holds the three things Hermes has no method for:

- the teammate's own store, ``<profile>/boopis/bot.json`` (its look and boopis's settings; never a Hermes key);
- archiving and restoring, as Hermes's own ``profile rename`` (an archived profile gives its name back);
- deleting, as Hermes's own ``profile delete``.

Both run through Hermes's CLI, the documented interface, never by writing Hermes's files.
"""
